import type { ChildProcess } from 'child_process';
import { createLogger } from '../utils/logger.js';

const log = createLogger('process-terminator');

export interface TerminationOptions {
  closeStdin: boolean;
  gracePeriodMs: number;
  forcePeriodMs: number;
  zombieTimeoutMs: number;
  throwOnZombie: boolean;
}

export class ProcessTerminator {
  constructor(private readonly options: TerminationOptions) {}

  async terminate(process: ChildProcess): Promise<void> {
    const logContext = this.options.throwOnZombie ? 'restart' : 'final cleanup';
    log.info(`Stopping process for ${logContext}`);

    return new Promise<void>((resolve, reject) => {
      let exited = false;
      const timeouts: NodeJS.Timeout[] = [];

      const cleanup = () => {
        exited = true;
        timeouts.forEach(clearTimeout);
      };

      process.once('exit', () => {
        cleanup();
        resolve();
      });

      // Step 1: Close stdin if requested
      if (this.options.closeStdin && process.stdin) {
        process.stdin.end();
      }

      // Step 2: Send SIGTERM after grace period
      if (this.options.gracePeriodMs > 0) {
        timeouts.push(setTimeout(() => {
          if (!exited) {
            process.kill('SIGTERM');
          }
        }, this.options.gracePeriodMs));
      } else {
        // Send SIGTERM immediately
        process.kill('SIGTERM');
      }

      // Step 3: Send SIGKILL after force period
      timeouts.push(setTimeout(() => {
        if (!exited) {
          log.warn('Process did not exit gracefully, forcing termination');
          process.kill('SIGKILL');
        }
      }, this.options.gracePeriodMs + this.options.forcePeriodMs));

      // Step 4: Handle zombie process
      timeouts.push(setTimeout(() => {
        if (!exited) {
          cleanup();
          if (this.options.throwOnZombie) {
            const error = new Error('Process cannot be killed - possible zombie process');
            log.error({ err: error }, 'Failed to terminate process');
            reject(error);
          } else {
            resolve(); // Process might be zombie, but we've done all we can
          }
        }
      }, this.options.gracePeriodMs + this.options.forcePeriodMs + this.options.zombieTimeoutMs));
    });
  }
}