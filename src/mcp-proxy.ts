import { Readable, Writable } from 'stream';
import { ProtocolHandler } from './protocol/protocol-handler.js';
import { BuildRunner } from './hot-reload/build-runner.js';
import { FileWatcher } from './hot-reload/file-watcher.js';
import { HotReload } from './hot-reload/hot-reload.js';
import { ProxyConfig } from './types.js';
import { createLogger } from './utils/logger.js';
import { McpServerLifecycle } from './process/lifecycle.js';
import { ProcessSpawner } from './process/spawner.js';
import { ProcessTerminator } from './process/terminator.js';
import { ProcessReadinessChecker } from './process/readiness-checker.js';
import { ServerConnection } from './process/server-connection.js';

const log = createLogger('mcp-proxy');

/**
 * MCPProxy - Transparent proxy between MCP client and MCP server
 *
 * Architecture:
 *   MCP Client (e.g., Claude) <-> MCPProxy (this) <-> MCP Server (user's implementation)
 *
 * Responsibilities:
 * - Acts as transparent proxy forwarding messages between client and server
 * - Preserves session state during server restarts
 * - Manages server lifecycle (start, stop, restart)
 * - Handles file watching and automatic rebuilds
 * - Ensures clean shutdown on signals from client
 * 
 * Note:
 * - DO NOT call stdin.resume() here! MessageRouter already handles this when it attaches the 'data' listener
 */
export class MCPProxy {
  private protocolHandler: ProtocolHandler;
  private serverLifecycle: McpServerLifecycle;
  private hotReload: HotReload;
  private config: Required<ProxyConfig>;
  private signalHandler?: () => void;
  private stdinEndHandler?: () => void;
  private stdinCloseHandler?: () => void;
  private currentServerConnection?: ServerConnection;

  constructor(
    config: ProxyConfig = {},
    private stdin: Readable = process.stdin,  // Input from MCP client
    private stdout: Writable = process.stdout // Output to MCP client
  ) {
    // Support both new names and deprecated aliases
    const mcpServerCommand = config.mcpServerCommand || config.serverCommand || 'node';
    const mcpServerArgs = config.mcpServerArgs || config.serverArgs || ['dist/index.js'];

    this.config = {
      buildCommand: config.buildCommand || 'npm run build',
      watchPattern: config.watchPattern || './src',
      debounceMs: config.debounceMs || 300,
      mcpServerCommand,
      mcpServerArgs,
      serverCommand: mcpServerCommand,  // Keep for internal compatibility
      serverArgs: mcpServerArgs,        // Keep for internal compatibility
      cwd: config.cwd || process.cwd(),
      env: config.env || {},
      onExit: config.onExit || ((code) => process.exit(code))
    };

    log.debug({ config: this.config }, 'Configuration loaded');

    // Setup unified protocol handler
    this.protocolHandler = new ProtocolHandler(
      this.stdin,   // From MCP client
      this.stdout   // To MCP client
    );

    // Setup server lifecycle with dependency injection
    const spawner = new ProcessSpawner();
    const readinessChecker = new ProcessReadinessChecker({
      checkIntervalMs: 50,
      timeoutMs: 2000,
      settleDelayMs: 100
    });
    const restartTerminator = new ProcessTerminator({
      closeStdin: false,
      gracePeriodMs: 0,
      forcePeriodMs: 100,
      zombieTimeoutMs: 500,
      throwOnZombie: true
    });

    this.serverLifecycle = new McpServerLifecycle(
      {
        command: this.config.mcpServerCommand,
        args: this.config.mcpServerArgs,
        cwd: this.config.cwd,
        env: {
          ...process.env,
          ...this.config.env,
          MCP_PROXY_INSTANCE: `mcp-proxy-${process.pid}-${Date.now()}`
        }
      },
      readinessChecker,
      restartTerminator,
      spawner
    );

    // Crash handler will be set up after server starts in the start() method

    // Register signal handlers immediately in constructor to ensure they're always active
    // This is critical for proper cleanup even if start() is skipped
    this.registerHandlers();

    // Setup hot reload
    if (!this.config.buildCommand || !this.config.buildCommand.trim()) {
      log.warn('No build command configured. Server will restart on file changes without building.');
    } else {
      log.info(`Build command: ${this.config.buildCommand}`);
    }

    const buildRunner = new BuildRunner(this.config.buildCommand, this.config.cwd);
    const fileWatcher = new FileWatcher({
      patterns: this.config.watchPattern,
      cwd: this.config.cwd,
      debounceMs: this.config.debounceMs
    });

    this.hotReload = new HotReload(buildRunner, fileWatcher);
  }

  public async start(): Promise<void> {
    // Prevent recursive proxying
    if (process.env.MCP_PROXY_INSTANCE) {
      log.info('Skipping start - already running as child of proxy');
      return;
    }

    // Start server and connect using ProtocolHandler
    this.currentServerConnection = await this.serverLifecycle.start();
    this.protocolHandler.connectServer(this.currentServerConnection);

    // Set up crash monitoring
    this.setupCrashMonitoring();

    // Start hot reload file watching
    this.hotReload.start();

    // Start the hot-reload loop in the background
    this.startHotReloadLoop().catch(error => {
      log.error({ err: error }, 'Hot-reload loop crashed');
    });

    this.stdin.on('error', (err) => {
      log.error({ err }, 'stdin error - treating as disconnect');
      process.exit(1);
    });

    // Signal handlers are already set up above
  }

  private restartInProgress = false;

  /**
   * Hot-reload loop that watches for file changes and rebuilds/restarts.
   * Ensures no overlapping restarts.
   */
  private async startHotReloadLoop(): Promise<void> {
    while (true) {
      try {
        // Wait for file changes
        const changedFiles = await this.hotReload.waitForChange();
        log.debug({ files: changedFiles }, 'Files changed');

        // Prevent overlapping restarts
        if (this.restartInProgress) {
          log.debug('Restart already in progress, skipping');
          continue;
        }

        this.restartInProgress = true;

        try {
          // Build on change
          const buildSuccess = await this.hotReload.buildOnChange();

          if (buildSuccess) {
            log.info('Build succeeded, restarting server');

            // Check if session was initialized BEFORE restart
            const wasInitialized = this.protocolHandler.getSessionState().initialized;

            // Disconnect old server
            this.protocolHandler.disconnectServer();

            // Clean up old connection
            if (this.currentServerConnection) {
              this.currentServerConnection.dispose();
            }

            // Restart server and connect with ProtocolHandler
            this.currentServerConnection = await this.serverLifecycle.restart();
            this.protocolHandler.connectServer(this.currentServerConnection);

            // Re-establish crash monitoring
            this.setupCrashMonitoring();

            // ProtocolHandler automatically handles session restoration
            // No need to manually re-send initialize request

            // Send tools changed notification if session was initialized before restart
            if (wasInitialized && this.stdout.writable && !(this.stdout as any).destroyed) {
              const notification = {
                jsonrpc: '2.0',
                method: 'notifications/tools/list_changed'
              };
              try {
                this.stdout.write(JSON.stringify(notification) + '\n');
              } catch (error) {
                log.debug('Failed to send tools changed notification');
              }
            }
          } else {
            log.error('Build failed, waiting for next change');
          }
        } finally {
          this.restartInProgress = false;
        }
      } catch (error) {
        log.error({ err: error }, 'Error in hot-reload loop');
        // Continue the loop even on errors
      }
    }
  }

  private registerHandlers(): void {
    // Create a truly "once" handler using closure
    const once = <T extends (...args: any[]) => void>(fn: T): T => {
      let called = false;
      return ((...args: any[]) => {
        if (!called) {
          called = true;
          return fn(...args);
        }
      }) as T;
    };

    // Single exit handler that will only run once across all events
    const exitHandler = once(() => {
      // Exit IMMEDIATELY - no async operations, no cleanup
      // The OS will clean up child processes automatically
      process.exit(0);
    });

    // Register the once-wrapped handler for all shutdown signals
    process.on('SIGINT', exitHandler);
    process.on('SIGTERM', exitHandler);
    this.stdin.on('end', exitHandler);
    this.stdin.on('close', exitHandler);

    // Store references for cleanup
    this.signalHandler = exitHandler;
    this.stdinEndHandler = exitHandler;
    this.stdinCloseHandler = exitHandler;
  }

  private setupCrashMonitoring(): void {
    if (!this.currentServerConnection) {
      return;
    }

    // Monitor for crashes asynchronously
    this.currentServerConnection.waitForCrash().then(({ code, signal }) => {
      this.handleServerCrash(code, signal);
    }).catch(error => {
      log.error({ err: error }, 'Error monitoring server crash');
    });
  }

  private handleServerCrash(code: number | null, signal: NodeJS.Signals | null): void {
    // Delegate to ProtocolHandler which handles crash recovery
    this.protocolHandler.handleServerCrash(code, signal);

    /* OLD CODE - Kept for reference, now handled by ProtocolHandler
    const pendingRequest = this.sessionTracker.getPendingRequest();

    if (pendingRequest && this.stdout.writable && !(this.stdout as any).destroyed) {
      // Build descriptive error message
      let errorMessage = 'MCP server process terminated unexpectedly';

      // Add specific exit information
      if (signal === 'SIGSEGV') {
        errorMessage += ' (segmentation fault - possible memory access violation)';
      } else if (signal === 'SIGKILL') {
        errorMessage += ' (killed forcefully - possible out of memory or manual termination)';
      } else if (signal === 'SIGTERM') {
        errorMessage += ' (terminated - process shutdown requested)';
      } else if (signal === 'SIGINT') {
        errorMessage += ' (interrupted - Ctrl+C or similar)';
      } else if (signal) {
        errorMessage += ` (signal: ${signal})`;
      } else if (code === 1) {
        errorMessage += ' (exit code 1 - general error, check server logs)';
      } else if (code === 127) {
        errorMessage += ' (exit code 127 - command not found)';
      } else if (code === 130) {
        errorMessage += ' (exit code 130 - terminated by Ctrl+C)';
      } else if (code === 137) {
        errorMessage += ' (exit code 137 - killed, possibly out of memory)';
      } else if (code === 143) {
        errorMessage += ' (exit code 143 - terminated by SIGTERM)';
      } else if (code !== null && code !== 0) {
        errorMessage += ` (exit code ${code})`;
      }

      errorMessage += '. Hot-reload will attempt to restart on next file change.';

      // Send JSON-RPC error response to the client
      const errorResponse = {
        jsonrpc: '2.0',
        id: pendingRequest.id,
        error: {
          code: -32603, // Internal error
          message: errorMessage,
          data: {
            exitCode: code,
            signal: signal,
            method: pendingRequest.method,
            info: 'Save a file to trigger rebuild and restart, or check server logs for crash details.'
          }
        }
      };

      try {
        log.info({ pendingRequestId: pendingRequest.id }, 'Sending crash error to client');
        this.stdout.write(JSON.stringify(errorResponse) + '\n');
        this.sessionTracker.clearPendingRequest();
      } catch (error) {
        log.error({ err: error }, 'Failed to send crash error to client');
      }
    } else if (!pendingRequest) {
      log.info('Server crashed but no pending request to notify');
    }
    */
  }

  public cleanup(): void {
    // Remove event listeners to prevent memory leaks
    if (this.signalHandler) {
      process.off('SIGINT', this.signalHandler);
      process.off('SIGTERM', this.signalHandler);
    }
    if (this.stdinEndHandler) {
      this.stdin.off('end', this.stdinEndHandler);
    }
    if (this.stdinCloseHandler) {
      this.stdin.off('close', this.stdinCloseHandler);
    }
  }

}