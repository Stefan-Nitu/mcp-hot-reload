#!/usr/bin/env node
import { spawn, ChildProcess, execSync } from 'child_process';
import chokidar, { FSWatcher } from 'chokidar';
import * as path from 'path';
import { Readable, Writable } from 'stream';
import * as micromatch from 'micromatch';
import { MessageParser } from './message-parser.js';
import { SessionManager } from './session-manager.js';
import { ProxyConfig, JSONRPCMessage } from './types.js';

export class MCPHotReload {
  private serverProcess: ChildProcess | null = null;
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private timeoutInterval: NodeJS.Timeout | null = null;
  private filePatterns: string[] = [];
  private messageParser = new MessageParser();
  private sessionManager = new SessionManager();
  private isRestarting = false;
  private config: Required<ProxyConfig>;

  // Internal metrics for testing (no logs, just state tracking)
  private metrics = {
    restartCount: 0,
    buildCount: 0,
    buildSuccessCount: 0,
    buildFailureCount: 0,
    messagesForwarded: 0,
    fileChangesDetected: 0
  };

  constructor(
    config: ProxyConfig = {},
    private stdin: Readable = process.stdin,
    private stdout: Writable = process.stdout,
    private stderr: Writable = process.stderr
  ) {
    this.config = {
      buildCommand: config.buildCommand || 'npm run build',
      watchPattern: config.watchPattern || './src',
      debounceMs: config.debounceMs || 300,
      serverCommand: config.serverCommand || 'node',
      serverArgs: config.serverArgs || ['dist/index.js'],
      cwd: config.cwd || process.cwd(),
      env: config.env || {},
      onExit: config.onExit || ((code) => process.exit(code))
    };
  }

  private handleIncomingData(data: Buffer): void {
    const { messages, rawMessages } = this.messageParser.parseMessages(data.toString());

    messages.forEach((message, index) => {
      const raw = rawMessages[index];

      if (this.isRestarting) {
        this.sessionManager.queueMessage(message, raw);
      } else {
        const shouldForward = this.sessionManager.handleClientMessage(message, raw);

        if (shouldForward && this.serverProcess?.stdin?.writable) {
          this.serverProcess.stdin.write(raw);
          this.metrics.messagesForwarded++;
        } else if (!shouldForward && message.method !== 'initialize') {
          this.sessionManager.queueMessage(message, raw);
        }
      }
    });
  }

  private handleServerOutput(data: Buffer): void {
    const output = data.toString();

    const { messages } = this.messageParser.parseMessages(output);
    messages.forEach(message => {
      this.sessionManager.handleServerMessage(message);
    });

    this.stdout.write(data);
  }

  private async startServer(): Promise<void> {

    if (this.serverProcess) {
      await this.stopServer();
    }

    // Run build command before starting server
    try {
      this.metrics.buildCount++;
      execSync(this.config.buildCommand, {
        stdio: ['ignore', 'ignore', 'pipe'],
        encoding: 'utf8',
        cwd: this.config.cwd
      });
      this.metrics.buildSuccessCount++;
    } catch (error: any) {
      this.metrics.buildFailureCount++;
      // Continue anyway - server might work without build
    }

    this.serverProcess = spawn(
      this.config.serverCommand,
      this.config.serverArgs,
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.config.cwd,
        env: {
          ...process.env,
          ...this.config.env,
          MCP_DEV_MODE: 'child'
        }
      }
    );

    this.serverProcess.stdout!.on('data', (data) => {
      this.handleServerOutput(data);
    });

    this.serverProcess.stderr!.on('data', (data) => {
    });

    this.serverProcess.on('exit', (code, signal) => {
      if (!this.isRestarting) {
        this.cleanup();
        this.config.onExit(code || 0);
      }
    });

    this.serverProcess.on('error', (err) => {
      if (!this.isRestarting) {
        this.cleanup();
        this.config.onExit(1);
      }
    });

    await this.waitForServerReady();

    const initRequest = this.sessionManager.getInitializeRequest();
    if (initRequest && this.serverProcess.stdin?.writable) {
      this.serverProcess.stdin.write(initRequest);

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const queuedMessages = this.sessionManager.getQueuedMessages();
    if (queuedMessages.length > 0) {
      for (const buffer of queuedMessages) {
        if (this.serverProcess.stdin?.writable) {
          this.serverProcess.stdin.write(buffer.raw);
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    }

    if (this.sessionManager.isSessionInitialized()) {
      const notification = this.sessionManager.createToolsChangedNotification();
      const notificationStr = JSON.stringify(notification) + '\n';
      this.stdout.write(notificationStr);
    }

    this.isRestarting = false;
  }

  private async stopServer(): Promise<void> {
    if (!this.serverProcess) return;

    return new Promise((resolve) => {
      const cleanup = () => {
        this.serverProcess?.removeAllListeners();
        this.serverProcess = null;
        resolve();
      };

      const timeout = setTimeout(() => {
        this.serverProcess?.kill('SIGKILL');
        cleanup();
      }, 5000);

      this.serverProcess?.once('exit', () => {
        clearTimeout(timeout);
        cleanup();
      });

      this.serverProcess?.kill('SIGTERM');
    });
  }

  private async waitForServerReady(): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.serverProcess?.stdin?.writable) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 2000);
    });
  }

  private async restartServer(): Promise<void> {
    this.isRestarting = true;
    this.metrics.restartCount++;

    try {
      await this.startServer();
    } catch (error: any) {
      this.isRestarting = false;
    }
  }

  private async setupWatcher(): Promise<void> {
    const patterns = this.normalizePatterns(this.config.watchPattern);
    if (!patterns.length) return;

    const watchTargets = this.extractWatchTargets(patterns);
    if (!watchTargets.length) return;

    this.watcher = chokidar.watch(watchTargets, this.getWatcherOptions());
    this.attachWatcherEventHandlers();
    await this.waitForWatcherReady();
  }

  private normalizePatterns(pattern: string | string[] | undefined): string[] {
    if (!pattern) return [];
    return Array.isArray(pattern) ? pattern : [pattern];
  }

  private extractWatchTargets(patterns: string[]): string[] {
    const targets = new Set<string>();
    this.filePatterns = [];

    for (const pattern of patterns) {
      const absolutePath = path.isAbsolute(pattern)
        ? pattern
        : path.join(this.config.cwd, pattern);

      if (this.isGlobPattern(absolutePath)) {
        // Store the glob pattern for file matching
        this.filePatterns.push(absolutePath);
        // Extract base directory to watch
        targets.add(this.extractDirFromGlob(absolutePath));
      } else {
        // Direct directory - default to TypeScript files
        targets.add(absolutePath);
        this.filePatterns.push(path.join(absolutePath, '**/*.ts'));
        this.filePatterns.push(path.join(absolutePath, '**/*.tsx'));
        this.filePatterns.push(path.join(absolutePath, '**/*.mts'));
        this.filePatterns.push(path.join(absolutePath, '**/*.cts'));
      }
    }

    return Array.from(targets);
  }

  private isGlobPattern(path: string): boolean {
    return path.includes('*') || path.includes('?');
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

  private getWatcherOptions() {
    return {
      persistent: true,
      ignoreInitial: true,
      depth: 99,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      },
      ignorePermissionErrors: true,
      atomic: true,
      ignored: (filePath: string, stats?: any) => {
        if (!stats?.isFile()) return false;
        return !this.shouldWatchFile(filePath);
      }
    };
  }


  private attachWatcherEventHandlers(): void {
    if (!this.watcher) return;

    this.watcher.on('error', this.logDebug.bind(this, 'Watcher error:'));
    this.watcher.on('add', this.handleFileChange.bind(this));
    this.watcher.on('change', this.handleFileChange.bind(this));
  }

  private async waitForWatcherReady(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.watcher!.once('ready', resolve);
    });
  }

  private shouldWatchFile(filePath: string): boolean {
    // If we have file patterns from config, use them
    if (this.filePatterns.length > 0) {
      return micromatch.isMatch(filePath, this.filePatterns);
    }
    // Default to TypeScript files
    return this.isTypeScriptFile(filePath);
  }

  private isTypeScriptFile(path: string): boolean {
    return path.endsWith('.ts') || path.endsWith('.tsx') ||
           path.endsWith('.mts') || path.endsWith('.cts');
  }

  private logDebug(message: string, ...args: any[]): void {
    if (process.env.DEBUG) {
      console.error(`[MCPHotReload] ${message}`, ...args);
    }
  }

  private handleFileChange(filePath: string): void {
    this.logDebug('File changed:', filePath);
    this.metrics.fileChangesDetected++;
    this.debounceRestart();
  }

  private debounceRestart(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.restartServer();
    }, this.config.debounceMs);
  }

  private handleTimeout(): void {
    const timedOut = this.sessionManager.clearPendingRequests(30000); // 30 second timeout

    timedOut.forEach(buffer => {
      const errorResponse: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: buffer.message.id,
        error: {
          code: -32603,
          message: 'Request timed out during server restart'
        }
      };
      this.stdout.write(JSON.stringify(errorResponse) + '\n');
    });
  }

  private cleanup(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
      this.timeoutInterval = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
      this.serverProcess = null;
    }
  }

  public async start(): Promise<void> {
    if (process.env.MCP_DEV_MODE === 'child') {
      return;
    }

    this.stdin.on('data', (data) => this.handleIncomingData(data));

    process.on('SIGINT', async () => {
      await this.stopServer();
      this.cleanup();
      this.config.onExit(0);
    });

    process.on('SIGTERM', async () => {
      await this.stopServer();
      this.cleanup();
      this.config.onExit(0);
    });

    this.timeoutInterval = setInterval(() => {
      if (this.isRestarting) {
        this.handleTimeout();
      }
    }, 5000);
    // Allow process to exit even if interval is active
    this.timeoutInterval.unref();

    await this.startServer();
    await this.setupWatcher();
  }

  public async stop(): Promise<void> {
    await this.stopServer();
    this.cleanup();
  }

  // Getter for tests to verify behavior
  public getMetrics() {
    return { ...this.metrics };
  }
}

