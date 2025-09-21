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
  private globPatterns: string[] = [];

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

    const patterns = this.normalizePatterns(this.config.patterns);
    const watchTargets = new Set<string>();
    this.globPatterns = [];

    // Process each pattern to extract watch targets and glob patterns
    for (const pattern of patterns) {
      const absolutePath = path.isAbsolute(pattern)
        ? pattern
        : path.join(this.config.cwd, pattern);

      if (this.isGlobPattern(absolutePath)) {
        // Store the glob pattern for filtering
        this.globPatterns.push(absolutePath);
        // Extract base directory to watch
        watchTargets.add(this.extractBaseDir(absolutePath));
      } else {
        // Direct path, watch as-is
        watchTargets.add(absolutePath);
      }
    }

    const watchPaths = Array.from(watchTargets);
    if (!watchPaths.length) {
      log.warn('No watch targets found');
      return;
    }

    this.watcher = chokidar.watch(watchPaths, {
      persistent: true,
      ignoreInitial: true,
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.vscode/**']
    });

    this.watcher.on('change', (filePath) => this.handleChange(filePath));
    this.watcher.on('add', (filePath) => this.handleChange(filePath));
    this.watcher.on('unlink', (filePath) => this.handleChange(filePath));
    this.watcher.on('error', (error) => log.error({ err: error }, 'Watcher error'));

    log.debug({ paths: watchPaths, globs: this.globPatterns }, 'Started watching');
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
    log.debug({ filePath }, 'File change detected');
    let isValid = false;

    // If we have glob patterns, check if the file matches any of them
    if (this.globPatterns.length > 0) {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.config.cwd, filePath);

      if (micromatch.isMatch(absolutePath, this.globPatterns)) {
        isValid = true;
        log.debug({ filePath, absolutePath }, 'File matches glob pattern');
      } else {
        log.debug({ filePath, absolutePath, patterns: this.globPatterns }, 'File does not match glob patterns');
      }
    } else {
      // No glob patterns, filter by extension
      const ext = path.extname(filePath);
      if (this.config.extensions.includes(ext)) {
        isValid = true;
      } else {
        log.trace({ filePath }, 'Ignoring file (not watched extension)');
      }
    }

    if (isValid) {
      log.debug({ filePath }, 'File change detected');
      this.pendingFiles.add(filePath);

      // Only trigger debounce timer for valid files
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.notifyChanges();
      }, this.config.debounceMs);
    }
  }

  private notifyChanges(): void {
    // Notify all waiting promises
    const queue = this.changeQueue.splice(0);
    queue.forEach(notify => notify());
  }

  private normalizePatterns(patterns: string | string[]): string[] {
    return Array.isArray(patterns) ? patterns : [patterns];
  }

  private isGlobPattern(pattern: string): boolean {
    return pattern.includes('*') || pattern.includes('?') || pattern.includes('[') || pattern.includes('{');
  }

  private extractBaseDir(globPath: string): string {
    // Find the first directory before any glob characters
    const parts = globPath.split(path.sep);
    const baseParts: string[] = [];

    for (const part of parts) {
      if (this.isGlobPattern(part)) {
        break;
      }
      baseParts.push(part);
    }

    // Return the base directory path
    const baseDir = baseParts.join(path.sep);
    return baseDir || path.dirname(globPath);
  }

}