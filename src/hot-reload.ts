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