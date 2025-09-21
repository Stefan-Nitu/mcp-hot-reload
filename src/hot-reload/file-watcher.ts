import chokidar, { FSWatcher } from 'chokidar';
import * as path from 'path';
import micromatch from 'micromatch';
import { createLogger } from '../utils/logger.js';

const log = createLogger('file-watcher');

export interface FileWatcherConfig {
  patterns: string | string[];
  cwd?: string;
  debounceMs?: number;
  extensions?: string[];  // Optional custom extensions to watch
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private config: Required<FileWatcherConfig>;
  private debounceTimer: NodeJS.Timeout | null = null;
  private changeQueue: Array<() => void> = [];
  private pendingFiles = new Set<string>();
  private filePatterns: string[] = [];

  constructor(config: FileWatcherConfig) {
    this.config = {
      patterns: config.patterns,
      cwd: config.cwd || process.cwd(),
      debounceMs: config.debounceMs || 300,
      extensions: config.extensions || [
        '.ts', '.tsx', '.mts', '.cts',  // TypeScript
        '.js', '.jsx', '.mjs', '.cjs',  // JavaScript
        '.py', '.pyw',                   // Python
        '.go',                           // Go
        '.rs',                           // Rust
        '.java',                         // Java
        '.rb',                           // Ruby
        '.php',                          // PHP
        '.cpp', '.c', '.h', '.hpp',      // C/C++
        '.cs'                            // C#
      ]
    };
  }

  start(): void {
    if (this.watcher) {
      return; // Already watching
    }

    const watchTargets = this.extractWatchTargets(this.normalizePatterns(this.config.patterns));
    if (!watchTargets.length) {
      log.warn({
        patterns: this.config.patterns,
        cwd: this.config.cwd,
        normalizedPatterns: this.normalizePatterns(this.config.patterns)
      }, 'No watch targets found');
      return;
    }

    this.watcher = chokidar.watch(watchTargets, {
      persistent: true,
      ignoreInitial: true,
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.vscode/**']
    });

    this.watcher.on('change', (filePath) => this.handleChange(filePath));
    this.watcher.on('add', (filePath) => this.handleChange(filePath));
    this.watcher.on('unlink', (filePath) => this.handleChange(filePath));
    this.watcher.on('error', (error) => log.error({ err: error }, 'Watcher error'));

    log.debug({ targets: watchTargets }, 'Started watching');
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    log.debug('Stopped watching');
  }

  /**
   * Wait for the next file change.
   * Returns a promise that resolves when watched files change.
   * Returns list of changed files (after debouncing).
   */
  waitForChange(): Promise<string[]> {
    return new Promise((resolve) => {
      this.changeQueue.push(() => {
        const files = Array.from(this.pendingFiles);
        this.pendingFiles.clear();
        resolve(files);
      });
    });
  }

  private handleChange(filePath: string): void {
    log.error({
      filePath,
      isAbsolute: path.isAbsolute(filePath),
      cwd: this.config.cwd
    }, 'handleChange called');

    if (!this.shouldWatchFile(filePath)) {
      log.trace({ filePath }, 'Ignoring file (not watched type)');
      return;
    }

    log.debug({ filePath }, 'File change detected');
    this.pendingFiles.add(filePath);

    // Trigger debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.notifyChanges();
    }, this.config.debounceMs);
  }

  private notifyChanges(): void {
    // Notify all waiting promises
    const queue = this.changeQueue.splice(0);
    queue.forEach(notify => notify());
  }

  private normalizePatterns(patterns: string | string[]): string[] {
    return Array.isArray(patterns) ? patterns : [patterns];
  }

  private extractWatchTargets(patterns: string[]): string[] {
    const targets = new Set<string>();
    this.filePatterns = [];

    for (const pattern of patterns) {
      const absolutePath = path.isAbsolute(pattern)
        ? pattern
        : path.join(this.config.cwd, pattern);

      if (this.isGlobPattern(absolutePath)) {
        this.filePatterns.push(absolutePath);
        const baseDir = this.extractDirFromGlob(absolutePath);
        targets.add(baseDir);
        log.error({
          pattern,
          absolutePath,
          baseDir,
          isGlob: true,
          cwd: this.config.cwd
        }, 'Processing glob pattern');
      } else {
        targets.add(absolutePath);
        log.error({
          pattern,
          absolutePath,
          isGlob: false,
          cwd: this.config.cwd
        }, 'Processing direct path');
      }
    }

    log.error({
      patterns,
      filePatterns: this.filePatterns,
      watchTargets: Array.from(targets),
      cwd: this.config.cwd,
      platform: process.platform,
      pathSep: path.sep
    }, 'Extracted watch targets');

    return Array.from(targets);
  }

  private isGlobPattern(pattern: string): boolean {
    return pattern.includes('*') || pattern.includes('?');
  }

  private extractDirFromGlob(globPath: string): string {
    const parts = globPath.split(path.sep);
    const nonGlobParts: string[] = [];

    for (const part of parts) {
      if (this.isGlobPattern(part)) break;
      nonGlobParts.push(part);
    }

    return nonGlobParts.length ? nonGlobParts.join(path.sep) : path.dirname(globPath);
  }

  private shouldWatchFile(filePath: string): boolean {
    // If we have glob patterns, use them
    if (this.filePatterns.length > 0) {
      const matches = micromatch.isMatch(filePath, this.filePatterns);
      log.error({
        filePath,
        filePatterns: this.filePatterns,
        matches,
        platform: process.platform
      }, 'Checking file against patterns');
      return matches;
    }

    // Otherwise, filter by common source extensions
    const ext = path.extname(filePath);
    const matches = this.config.extensions.includes(ext);
    log.debug({
      filePath,
      ext,
      extensions: this.config.extensions,
      matches
    }, 'Checking file extension');
    return matches;
  }

}