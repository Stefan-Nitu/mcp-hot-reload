import { ChildProcess, spawn, SpawnOptions } from 'child_process';
import { createLogger } from './utils/logger.js';

const log = createLogger('process-manager');

export interface ProcessConfig {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export class ProcessManager {
  private process: ChildProcess | null = null;

  async start(config: ProcessConfig): Promise<ChildProcess> {
    const spawnOptions: SpawnOptions = {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: config.cwd,
      env: { ...process.env, ...config.env }
    };

    log.info({ command: config.command, args: config.args }, 'Starting process');

    this.process = spawn(config.command, config.args, spawnOptions);

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Failed to create process streams');
    }

    return this.process;
  }

  async stop(timeout = 5000): Promise<void> {
    if (!this.process) {
      return;
    }

    log.info('Stopping process');

    return new Promise((resolve) => {
      const proc = this.process!;

      const timeoutHandle = setTimeout(() => {
        log.warn('Process did not exit gracefully, forcing termination');
        proc.kill('SIGKILL');
        cleanup();
        resolve();
      }, timeout);

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        proc.removeAllListeners();
        this.process = null;
      };

      proc.once('exit', () => {
        cleanup();
        resolve();
      });

      proc.kill('SIGTERM');
    });
  }
}