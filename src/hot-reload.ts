import { BuildRunner } from './build-runner.js';
import { FileWatcher } from './file-watcher.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('hot-reload');

/**
 * HotReload manages the entire hot reload cycle:
 * - Watches files for changes
 * - Runs builds when changes are detected
 * - Triggers server restarts when builds succeed
 * - Waits for next change if build fails
 */
export class HotReload {
  private hasPendingChange = false;
  private currentOperation: Promise<void> | null = null;

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
    // Mark that we have a change to process
    this.hasPendingChange = true;

    // If already processing, just wait for the current operation
    if (this.currentOperation) {
      return this.currentOperation;
    }

    // Start processing
    this.currentOperation = this.processChanges();

    try {
      await this.currentOperation;
    } finally {
      this.currentOperation = null;
    }
  }

  private async processChanges(): Promise<void> {
    while (this.hasPendingChange) {
      this.hasPendingChange = false;

      try {
        await this.performBuildAndRestart();
      } catch (error) {
        // Log error but continue processing if there are more changes
        log.error({ err: error }, 'Error in build/restart cycle');
        throw error;
      }
    }
  }

  private async performBuildAndRestart(): Promise<void> {
    log.info('File change detected, starting build/restart cycle');

    // Cancel any ongoing build when new changes arrive
    this.buildRunner.cancel();

    const buildSuccess = await this.buildRunner.run();

    if (buildSuccess) {
      log.info('Build succeeded, restarting server');
      await this.onRestart();
    } else {
      log.error('Build failed, waiting for next file change...');
    }
  }
}