import { BuildRunner } from './build-runner.js';
import { FileWatcher } from './file-watcher.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('hot-reload');

/**
 * HotReload coordinates file watching and building.
 * Returns build results for the caller to decide what to do.
 */
export class HotReload {
  private pendingBuild: Promise<boolean> | null = null;
  private buildAbortController: AbortController | null = null;

  constructor(
    private buildRunner: BuildRunner,
    private fileWatcher: FileWatcher
  ) {}

  start(): void {
    this.fileWatcher.start();
  }

  stop(): void {
    // Cancel any pending build immediately for quick shutdown
    this.cancel();
    this.fileWatcher.stop();
  }

  /**
   * Build when file changes are detected.
   * Returns true if build succeeded, false if failed.
   * Cancels any in-progress build.
   */
  async buildOnChange(): Promise<boolean> {
    // Cancel any existing build
    if (this.buildAbortController) {
      this.buildAbortController.abort();
    }

    // Create new abort controller for this build
    this.buildAbortController = new AbortController();

    // Always cancel previous build to ensure clean state
    this.buildRunner.cancel();

    log.info('File change detected, starting build');

    // Start the build
    this.pendingBuild = this.buildRunner.run();

    try {
      const success = await this.pendingBuild;

      if (success) {
        log.info('Build succeeded');
      } else {
        log.error('Build failed');
      }

      return success;
    } finally {
      this.pendingBuild = null;
    }
  }

  /**
   * Wait for the next file change.
   * Returns a promise that resolves with the list of changed files.
   */
  async waitForChange(): Promise<string[]> {
    return this.fileWatcher.waitForChange();
  }

  /**
   * Cancel any pending operations
   */
  cancel(): void {
    if (this.buildAbortController) {
      this.buildAbortController.abort();
      this.buildAbortController = null;
    }
    this.buildRunner.cancel();
  }
}