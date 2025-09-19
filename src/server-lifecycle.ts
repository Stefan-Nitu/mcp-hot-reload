import { ChildProcess } from 'child_process';
import { ProcessManager } from './process-manager.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('server-lifecycle');

export interface ServerConfig {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LifecycleCallbacks {
  onServerReady?: (process: ChildProcess) => void;
  onServerExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onShutdown?: (exitCode: number) => void;
}

export class ServerLifecycle {
  private process: ChildProcess | null = null;
  private isShuttingDown = false;
  private signalHandlers: Array<{ event: NodeJS.Signals; handler: () => void }> = [];
  private stoppingPromise: Promise<void> | null = null;

  constructor(
    private processManager: ProcessManager,
    private config: ServerConfig,
    private callbacks: LifecycleCallbacks = {}
  ) {}

  async start(): Promise<ChildProcess> {
    log.info('Starting server...');

    this.process = await this.processManager.start({
      command: this.config.command,
      args: this.config.args,
      cwd: this.config.cwd,
      env: this.config.env
    });

    // Setup exit handler
    this.process.on('exit', (code, signal) => {
      log.error({ code, signal }, 'Server exited');
      this.process = null;
      this.callbacks.onServerExit?.(code, signal);
    });

    try {
      await this.waitForReady();
    } catch (error) {
      log.error({ err: error }, 'Failed to start server');
      throw error;
    }

    log.debug('Calling onServerReady callback');
    this.callbacks.onServerReady?.(this.process);
    return this.process;
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    // If already stopping, return the existing promise
    if (this.stoppingPromise) {
      return this.stoppingPromise;
    }

    this.stoppingPromise = this.processManager.stop()
      .then(() => {
        this.process = null;
        this.stoppingPromise = null;
      });

    return this.stoppingPromise;
  }

  async restart(): Promise<ChildProcess> {
    await this.stop();
    return this.start();
  }

  private async waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let readyDetected = false;

      const cleanup = () => {
        resolved = true;
        clearInterval(checkInterval);
        clearTimeout(timeoutHandle);
        if (this.process) {
          this.process.removeListener('exit', earlyExitHandler);
        }
      };

      const earlyExitHandler = () => {
        if (!resolved) {
          cleanup();
          reject(new Error('Process exited during startup'));
        }
      };

      // Listen for early exit
      if (this.process) {
        this.process.once('exit', earlyExitHandler);
      }

      const checkInterval = setInterval(() => {
        if (!this.process) {
          if (!resolved) {
            cleanup();
            reject(new Error('Process exited during startup'));
          }
          return;
        }

        if (this.process.stdin?.writable && !readyDetected) {
          readyDetected = true;
          // Give a brief grace period to catch immediate exits
          setTimeout(() => {
            if (!resolved && this.process) {
              cleanup();
              resolve();
            }
          }, 100);
        }
      }, 50);

      // Timeout after 2 seconds
      const timeoutHandle = setTimeout(() => {
        if (!resolved) {
          cleanup();
          if (this.process) {
            resolve();
          } else {
            reject(new Error('Process exited during startup'));
          }
        }
      }, 2000);
    });
  }

  enableSignalHandling(): void {
    const signalHandler = () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      log.info('Received shutdown signal, cleaning up...');

      Promise.race([
        this.stop().then(() => {
          this.callbacks.onShutdown?.(0);
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Cleanup timeout')), 5000)
        )
      ]).catch(error => {
        log.error({ err: error }, 'Error during shutdown');
        this.callbacks.onShutdown?.(1);
      });
    };

    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);

    this.signalHandlers = [
      { event: 'SIGINT', handler: signalHandler },
      { event: 'SIGTERM', handler: signalHandler }
    ];
  }

  disableSignalHandling(): void {
    this.signalHandlers.forEach(({ event, handler }) => {
      process.removeListener(event, handler);
    });
    this.signalHandlers = [];
  }

  isRunning(): boolean {
    return this.process !== null;
  }
}