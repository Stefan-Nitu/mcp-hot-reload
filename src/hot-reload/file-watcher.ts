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

    const patterns = this.normalizePatterns(this.config.patterns);
    const watchTargets = new Set<string>();
    this.filePatterns = [];

    // Process each pattern to extract watch targets and file patterns
    for (const pattern of patterns) {
      const absolutePath = path.isAbsolute(pattern)
        ? pattern
        : path.join(this.config.cwd, pattern);

      if (this.isGlobPattern(absolutePath)) {
        // Store the pattern as-is for later matching
        this.filePatterns.push(pattern);
        // Extract base directory to watch
        const baseDir = this.extractBaseDir(absolutePath);
        watchTargets.add(baseDir);
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

    log.debug({ paths: watchPaths, patterns: this.filePatterns }, 'Started watching');
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
    // Check if we should watch this file
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

  private shouldWatchFile(filePath: string): boolean {
    // If we have glob patterns, use them
    if (this.filePatterns.length > 0) {
      // Convert absolute path to relative for matching
      const relativePath = path.isAbsolute(filePath)
        ? path.relative(this.config.cwd, filePath)
        : filePath;

      // Normalize to use forward slashes for glob matching
      const normalizedPath = relativePath.replace(/\\/g, '/');

      // Also try with ./ prefix as patterns may use it
      const pathsToTry = [normalizedPath, `./${normalizedPath}`];

      const matches = pathsToTry.some(p => micromatch.isMatch(p, this.filePatterns));

      log.debug({
        filePath,
        relativePath: normalizedPath,
        patterns: this.filePatterns,
        matches,
        cwd: this.config.cwd
      }, 'Glob pattern matching');

      return matches;
    }

    // Otherwise, filter by common source extensions
    const ext = path.extname(filePath);
    return this.config.extensions.includes(ext);
  }

}