import { spawn, ChildProcess } from 'child_process';
import { createLogger } from './utils/logger.js';

const log = createLogger('build-runner');

export class BuildRunner {
  private currentBuild: ChildProcess | null = null;
  private buildTimeout: NodeJS.Timeout | null = null;

  constructor(
    private command: string,
    private cwd: string,
    private timeoutMs: number = 60000
  ) {}

  async run(): Promise<boolean> {
    if (this.isEmptyCommand()) {
      // No build step needed - this is valid for interpreted languages
      return true;
    }

    this.cancel();
    return this.executeBuild();
  }

  cancel(): void {
    this.killCurrentBuild();
    this.clearTimeout();
  }

  private isEmptyCommand(): boolean {
    return !this.command || !this.command.trim();
  }

  private executeBuild(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      log.debug({ command: this.command }, 'Starting build');

      this.currentBuild = spawn(this.command, [], {
        cwd: this.cwd,
        shell: true,
        stdio: 'ignore'
      });

      this.setupTimeout();
      this.setupProcessHandlers(resolve);
    });
  }

  private setupTimeout(): void {
    this.buildTimeout = setTimeout(() => {
      log.warn('Build timed out, killing process');
      this.cancel();
    }, this.timeoutMs);
  }

  private setupProcessHandlers(resolve: (success: boolean) => void): void {
    if (!this.currentBuild) return;

    this.currentBuild.on('exit', (code, signal) => {
      this.cleanup();
      resolve(this.evaluateExitStatus(code, signal));
    });

    this.currentBuild.on('error', (error) => {
      log.error({ err: error }, 'Build process error');
      this.cleanup();
      resolve(false);
    });
  }

  private evaluateExitStatus(code: number | null, signal: string | null): boolean {
    if (signal) {
      log.debug(`Build terminated with signal: ${signal}`);
      return false;
    }

    if (code === 0) {
      log.debug('Build completed successfully');
      return true;
    }

    log.debug({ code }, 'Build failed');
    return false;
  }

  private killCurrentBuild(): void {
    if (!this.currentBuild) return;

    log.debug('Cancelling current build');
    this.currentBuild.kill('SIGTERM');

    setTimeout(() => {
      if (this.currentBuild && !this.currentBuild.killed) {
        log.warn('Force killing build process');
        this.currentBuild.kill('SIGKILL');
      }
    }, 1000);
  }

  private clearTimeout(): void {
    if (this.buildTimeout) {
      clearTimeout(this.buildTimeout);
      this.buildTimeout = null;
    }
  }

  private cleanup(): void {
    this.clearTimeout();
    this.currentBuild = null;
  }
}