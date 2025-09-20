import type { ChildProcess } from 'child_process';

export interface ReadinessConfig {
  checkIntervalMs?: number;
  timeoutMs?: number;
  settleDelayMs?: number;
}

export class ProcessReadinessChecker {
  private readonly checkIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly settleDelayMs: number;

  constructor(config: ReadinessConfig = {}) {
    this.checkIntervalMs = config.checkIntervalMs ?? 50;
    this.timeoutMs = config.timeoutMs ?? 5000;
    this.settleDelayMs = config.settleDelayMs ?? 100;
  }

  async waitUntilReady(process: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let readyDetected = false;

      const cleanup = () => {
        resolved = true;
        clearInterval(checkInterval);
        clearTimeout(timeoutHandle);
        process.removeListener('exit', earlyExitHandler);
      };

      const earlyExitHandler = () => {
        if (!resolved) {
          cleanup();
          reject(new Error('Process exited during startup'));
        }
      };

      process.once('exit', earlyExitHandler);

      const checkInterval = setInterval(() => {
        if (!process || process.killed) {
          if (!resolved) {
            cleanup();
            reject(new Error('Process exited during startup'));
          }
          return;
        }

        if (process.stdin?.writable && !readyDetected) {
          readyDetected = true;
          // Give it a moment to settle
          setTimeout(() => {
            if (!resolved) {
              cleanup();
              resolve();
            }
          }, this.settleDelayMs);
        }
      }, this.checkIntervalMs);

      const timeoutHandle = setTimeout(() => {
        if (!resolved) {
          cleanup();
          reject(new Error('Process stdin not ready after timeout'));
        }
      }, this.timeoutMs);
    });
  }
}