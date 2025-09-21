import { Readable, Writable } from 'stream';
import { MessageRouter } from './messaging/router.js';
import { MessageQueue } from './messaging/queue.js';
import { MessageParser } from './messaging/parser.js';
import { SessionTracker } from './session/tracker.js';
import { BuildRunner } from './hot-reload/build-runner.js';
import { FileWatcher } from './hot-reload/file-watcher.js';
import { HotReload } from './hot-reload/hot-reload.js';
import { ProxyConfig } from './types.js';
import { createLogger } from './utils/logger.js';
import { McpServerLifecycle } from './process/lifecycle.js';
import { ProcessSpawner } from './process/spawner.js';
import { ProcessTerminator } from './process/terminator.js';
import { ProcessReadinessChecker } from './process/readiness-checker.js';

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
 */
export class MCPProxy {
  private messageRouter: MessageRouter;
  private serverLifecycle: McpServerLifecycle;
  private hotReload: HotReload;
  private sessionTracker: SessionTracker;
  private config: Required<ProxyConfig>;
  private signalHandler?: () => void;
  private stdinEndHandler?: () => void;
  private stdinCloseHandler?: () => void;
  private handlersRegistered = false;

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

    // Setup message routing between MCP client and MCP server
    const messageQueue = new MessageQueue();
    const messageParser = new MessageParser();
    this.sessionTracker = new SessionTracker(messageParser);
    this.messageRouter = new MessageRouter(
      this.stdin,   // From MCP client
      this.stdout,  // To MCP client
      messageQueue,
      this.sessionTracker
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

    // Signal handlers will be setup in start() to avoid memory leaks

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

    // Setup handlers only once to avoid memory leaks
    if (!this.handlersRegistered) {
      this.registerHandlers();
      this.handlersRegistered = true;
    }

    // Start server and connect streams
    const { stdin: serverStdin, stdout: serverStdout } = await this.serverLifecycle.start();
    this.messageRouter.connectServer(serverStdin, serverStdout);

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

    // Keep stdin open
    this.stdin.resume();

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

            // Disconnect old streams
            this.messageRouter.disconnectServer();

            // Restart server and get new streams
            const { stdin: serverStdin, stdout: serverStdout } = await this.serverLifecycle.restart();

            // Connect new streams
            this.messageRouter.connectServer(serverStdin, serverStdout);

            // If we have a stored initialize request, re-send it to restore session
            const initRequest = this.sessionTracker.getInitializeRequest();
            if (initRequest && serverStdin.writable) {
              log.info('Re-sending initialize request after restart');
              try {
                serverStdin.write(initRequest);
              } catch (error) {
                log.error({ err: error }, 'Failed to re-send initialize request');
              }
            }

            // Send tools changed notification if session was initialized
            const wasInitialized = this.sessionTracker.isInitialized();
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
    this.handlersRegistered = false;
  }

}