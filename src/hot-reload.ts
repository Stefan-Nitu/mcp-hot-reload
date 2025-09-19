import { BuildRunner } from './build-runner.js';
import { FileWatcher } from './file-watcher.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('hot-reload');

const MAX_BUILD_ATTEMPTS = 3;
const BUILD_RETRY_DELAY_MS = 1000;

/**
 * HotReload manages the entire hot reload cycle:
 * - Watches files for changes
 * - Runs builds when changes are detected
 * - Retries builds if files change during build
 * - Triggers server restarts when builds succeed
 */
export class HotReload {
  constructor(
    private buildRunner: BuildRunner,
    private fileWatcher: FileWatcher,
    private onRestart: () => Promise<void>
  ) {}

  start(): void {
    this.fileWatcher.start();
  }

  stop(): void {
    this.fileWatcher.stop();
  }

  async handleFileChange(): Promise<void> {
    log.info('File change detected, starting build/restart cycle');

    for (let attempt = 1; attempt <= MAX_BUILD_ATTEMPTS; attempt++) {
      const buildSuccess = this.runBuild(attempt);
      const changedDuringBuild = this.checkForChanges();

      if (buildSuccess) {
        await this.handleSuccessfulBuild();

        if (!changedDuringBuild) {
          return; // Done - build succeeded and no new changes
        }

        log.info('Files changed during build/restart, rebuilding...');
      } else if (!changedDuringBuild) {
        log.error('Build failed, waiting for file changes...');
        return;
      } else {
        log.info('Build failed but files changed, retrying...');
      }

      if (attempt < MAX_BUILD_ATTEMPTS) {
        await this.delayBetweenAttempts();
      }
    }

    log.error({ attempts: MAX_BUILD_ATTEMPTS }, 'Max build attempts reached, stopping');
  }

  private runBuild(attempt: number): boolean {
    this.fileWatcher.pause();
    const success = this.buildRunner.run();
    this.fileWatcher.resume();
    return success;
  }

  private checkForChanges(): boolean {
    const changed = this.fileWatcher.pause();
    this.fileWatcher.resume();
    return changed;
  }

  private async handleSuccessfulBuild(): Promise<void> {
    log.info('Build succeeded, restarting server');
    await this.onRestart();
  }

  private async delayBetweenAttempts(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, BUILD_RETRY_DELAY_MS));
    this.checkForChanges();
  }
}