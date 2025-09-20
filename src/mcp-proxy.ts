import { Readable, Writable } from 'stream';
import { MessageRouter } from './message-router.js';
import { ServerLifecycle } from './server-lifecycle.js';
import { ProcessManager } from './process-manager.js';
import { MessageQueue } from './message-queue.js';
import { SessionTracker } from './session-tracker.js';
import { BuildRunner } from './build-runner.js';
import { FileWatcher } from './file-watcher.js';
import { HotReload } from './hot-reload.js';
import { ProxyConfig, JSONRPCMessage } from './types.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('mcp-proxy');

export class MCPProxy {
  private messageRouter: MessageRouter;
  private serverLifecycle: ServerLifecycle;
  private hotReload: HotReload;
  private sessionTracker: SessionTracker;
  private config: Required<ProxyConfig>;

  constructor(
    config: ProxyConfig = {},
    private stdin: Readable = process.stdin,
    private stdout: Writable = process.stdout,
    private stderr: Writable = process.stderr
  ) {
    this.config = {
      buildCommand: config.buildCommand || 'npm run build',
      watchPattern: config.watchPattern || './src',
      debounceMs: config.debounceMs || 300,
      serverCommand: config.serverCommand || 'node',
      serverArgs: config.serverArgs || ['dist/index.js'],
      cwd: config.cwd || process.cwd(),
      env: config.env || {},
      onExit: config.onExit || ((code) => process.exit(code))
    };

    log.debug({ config: this.config }, 'Configuration loaded');

    // Setup message routing
    const messageQueue = new MessageQueue();
    this.sessionTracker = new SessionTracker();
    this.messageRouter = new MessageRouter(
      this.stdin,
      this.stdout,
      messageQueue,
      this.sessionTracker
    );

    // Setup server lifecycle
    const processManager = new ProcessManager();
    this.serverLifecycle = new ServerLifecycle(
      processManager,
      {
        command: this.config.serverCommand,
        args: this.config.serverArgs,
        cwd: this.config.cwd,
        env: {
          ...process.env,
          ...this.config.env,
          MCP_PROXY_INSTANCE: `mcp-proxy-${process.pid}-${Date.now()}`
        }
      },
      {
        onServerReady: (process) => {
          // Connect message router to server
          if (process.stdin && process.stdout) {
            this.messageRouter.connectServer(process.stdin, process.stdout);
          }
        },
        onServerExit: (code, signal) => {
          log.error({ code, signal }, 'Server exited. Fix the code and save to restart.');
          this.messageRouter.disconnectServer();
        },
        onShutdown: (exitCode) => {
          // Skip cleanup and exit immediately - Claude only waits 250ms
          this.config.onExit(exitCode);
        }
      }
    );

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
      debounceMs: 100,
      onChange: () => this.hotReload.handleFileChange()
    });

    this.hotReload = new HotReload(
      buildRunner,
      fileWatcher,
      () => this.restartServer()
    );
  }

  public async start(): Promise<void> {
    // Prevent recursive proxying
    if (process.env.MCP_PROXY_INSTANCE) {
      log.info('Skipping start - already running as child of proxy');
      return;
    }

    // Start server
    await this.serverLifecycle.start();

    // Start hot reload
    this.hotReload.start();

    // Setup stdin closure handler
    this.stdin.on('end', () => {
      log.debug('Client disconnected (stdin closed)');
      this.stop();
    });

    // Keep stdin open
    this.stdin.resume();

    // Enable signal handling
    this.serverLifecycle.enableSignalHandling();
  }

  private async restartServer(): Promise<void> {
    const wasInitialized = this.sessionTracker.isInitialized();
    const initRequest = this.sessionTracker.getInitializeRequest();

    // Restart server
    const process = await this.serverLifecycle.restart();

    // Reconnect message router
    if (process.stdin && process.stdout) {
      this.messageRouter.connectServer(process.stdin, process.stdout);
    }

    // Re-send initialize if needed
    if (initRequest && process.stdin?.writable) {
      log.info('Re-sending cached initialize request during restart');
      process.stdin.write(initRequest);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Send tools changed notification if session was initialized
    if (wasInitialized && this.stdout.writable && !(this.stdout as any).destroyed) {
      const notification: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'notifications/tools/list_changed'
      };
      try {
        this.stdout.write(JSON.stringify(notification) + '\n');
      } catch (error) {
        log.debug('Failed to send tools changed notification');
      }
    }
  }

  public async stop(): Promise<void> {
    await this.serverLifecycle.stop();
    this.cleanup();
  }

  private cleanup(): void {
    this.hotReload.stop();
    this.messageRouter.stop();
    this.serverLifecycle.disableSignalHandling();
  }
}