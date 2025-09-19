import chokidar, { FSWatcher } from 'chokidar';
import * as path from 'path';
import micromatch from 'micromatch';
import { createLogger } from './utils/logger.js';

const log = createLogger('file-watcher');

export interface FileWatcherConfig {
  patterns: string | string[];
  cwd?: string;
  debounceMs?: number;
  onChange: () => void;
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private config: Required<Omit<FileWatcherConfig, 'onChange'>> & { onChange: () => void };
  private isPaused = false;
  private changedDuringPause = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private filePatterns: string[] = [];

  constructor(config: FileWatcherConfig) {
    this.config = {
      patterns: config.patterns,
      cwd: config.cwd || process.cwd(),
      debounceMs: config.debounceMs || 0,
      onChange: config.onChange
    };
  }

  start(): void {
    if (this.watcher) {
      return; // Already watching
    }

    const watchTargets = this.extractWatchTargets(this.normalizePatterns(this.config.patterns));
    if (!watchTargets.length) {
      log.warn('No watch targets found');
      return;
    }

    this.watcher = chokidar.watch(watchTargets, {
      persistent: true,
      ignoreInitial: true,
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**']
    });

    this.watcher.on('change', (filePath) => this.handleChange(filePath));
    this.watcher.on('add', (filePath) => this.handleChange(filePath));
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
    this.isPaused = false;
    this.changedDuringPause = false;
    log.debug('Stopped watching');
  }

  pause(): boolean {
    this.isPaused = true;
    const hadChanges = this.changedDuringPause;
    this.changedDuringPause = false;
    log.debug({ hadChanges }, 'Paused watching');
    return hadChanges;
  }

  resume(): void {
    this.isPaused = false;
    this.changedDuringPause = false;
    log.debug('Resumed watching');
  }

  private handleChange(filePath: string): void {
    if (!this.shouldWatchFile(filePath)) {
      log.trace({ filePath }, 'Ignoring file (not watched type)');
      return;
    }

    log.debug({ filePath }, 'File change detected');

    if (this.isPaused) {
      this.changedDuringPause = true;
      return;
    }

    if (this.config.debounceMs > 0) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.config.onChange();
      }, this.config.debounceMs);
    } else {
      this.config.onChange();
    }
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
        targets.add(this.extractDirFromGlob(absolutePath));
      } else {
        targets.add(absolutePath);
      }
    }

    return Array.from(targets);
  }

  private isGlobPattern(pattern: string): boolean {
    return pattern.includes('*') || pattern.includes('?');
  }

  private extractDirFromGlob(globPath: string): string {
    const parts = globPath.split('/');
    const nonGlobParts: string[] = [];

    for (const part of parts) {
      if (this.isGlobPattern(part)) break;
      nonGlobParts.push(part);
    }

    return nonGlobParts.length ? nonGlobParts.join('/') : path.dirname(globPath);
  }

  private shouldWatchFile(filePath: string): boolean {
    // If we have glob patterns, use them
    if (this.filePatterns.length > 0) {
      return micromatch.isMatch(filePath, this.filePatterns);
    }

    // Otherwise, filter by common source extensions
    const ext = path.extname(filePath);
    return [
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
    ].includes(ext);
  }
}