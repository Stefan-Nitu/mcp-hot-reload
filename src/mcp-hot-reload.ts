import { spawn, ChildProcess, execSync } from 'child_process';
import chokidar, { FSWatcher } from 'chokidar';
import * as path from 'path';
import { Readable, Writable } from 'stream';
import micromatch from 'micromatch';
import * as fs from 'fs';
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
  private isIntentionallyStopping = false;
  private config: Required<ProxyConfig>;
  private signalHandlers: { event: NodeJS.Signals; handler: () => void }[] = [];
  private restartAttempts = 0;
  private maxRestartAttempts = 3;
  private lastRestartTime = 0;
  private restartCooldownMs = 5000;
  private instanceId = `mcp-proxy-${process.pid}-${Date.now()}`;

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

    // Debug logging
    if (process.env.DEBUG) {
      console.error('[mcp-hot-reload] Config:', JSON.stringify(this.config, null, 2));
    }
  }

  private handleIncomingData(data: Buffer): void {
    // Pass through directly first
    if (this.serverProcess?.stdin?.writable) {
      this.serverProcess.stdin.write(data);
    }

    // Also parse and track messages for session management
    const { messages, rawMessages } = this.messageParser.parseMessages(data.toString());
    messages.forEach((message, index) => {
      const raw = rawMessages[index];
      // Just track it, don't make forwarding decisions
      this.sessionManager.handleClientMessage(message, raw);
    });

    // COMMENTED OUT: Complex message parsing
    // if (process.env.DEBUG) {
    //   console.error(`[mcp-hot-reload] handleIncomingData called, size: ${data.length}, isRestarting: ${this.isRestarting}`);
    // }
    // const { messages, rawMessages } = this.messageParser.parseMessages(data.toString());

    // messages.forEach((message, index) => {
    //   const raw = rawMessages[index];

    //   if (process.env.DEBUG) {
    //     console.error(`[mcp-hot-reload] Processing message ${index + 1}/${messages.length}, method: ${message.method}, id: ${message.id}`);
    //   }

    //   if (this.isRestarting) {
    //     if (process.env.DEBUG) {
    //       console.error('[mcp-hot-reload] Server is restarting, queueing message');
    //     }
    //     this.sessionManager.queueMessage(message, raw);
    //   } else {
    //     const shouldForward = this.sessionManager.handleClientMessage(message, raw);
    //     if (process.env.DEBUG) {
    //       console.error(`[mcp-hot-reload] shouldForward: ${shouldForward}, serverProcess exists: ${!!this.serverProcess}, stdin writable: ${this.serverProcess?.stdin?.writable}`);
    //     }

    //     if (shouldForward && this.serverProcess?.stdin?.writable) {
    //       if (process.env.DEBUG) {
    //         console.error('[mcp-hot-reload] Forwarding to server:', raw.substring(0, 100));
    //       }
    //       this.serverProcess.stdin.write(raw);
    //       this.metrics.messagesForwarded++;
    //     } else if (!shouldForward && message.method !== 'initialize') {
    //       if (process.env.DEBUG) {
    //         console.error('[mcp-hot-reload] Queueing message, not ready yet');
    //       }
    //       this.sessionManager.queueMessage(message, raw);
    //     } else if (process.env.DEBUG) {
    //       console.error('[mcp-hot-reload] Not forwarding - shouldForward:', shouldForward, 'writable:', this.serverProcess?.stdin?.writable);
    //     }
    //   }
    // });
  }

  private handleServerOutput(data: Buffer): void {
    // Pass through immediately
    this.stdout.write(data);

    // Also track messages for session management
    const output = data.toString();
    if (process.env.DEBUG) {
      console.error('[mcp-hot-reload] Server output:', output.substring(0, 200));
    }

    const { messages } = this.messageParser.parseMessages(output);
    messages.forEach(message => {
      this.sessionManager.handleServerMessage(message);
    });
  }

  private serverStartCount = 0;

  private async startServer(): Promise<void> {
    this.serverStartCount++;
    if (process.env.DEBUG) {
      console.error(`[mcp-hot-reload] Starting server... (call #${this.serverStartCount})`);
    }

    if (this.serverProcess) {
      await this.stopServer();
    }

    // Run build command before starting server
    try {
      if (process.env.DEBUG) {
        console.error('[mcp-hot-reload] Running build command:', this.config.buildCommand);
      }
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

    if (process.env.DEBUG) {
      console.error('[mcp-hot-reload] Spawning:', this.config.serverCommand, this.config.serverArgs);
    }

    if (process.env.DEBUG) {
      console.error(`[mcp-hot-reload] About to spawn, serverProcess is currently: ${this.serverProcess ? 'EXISTS' : 'null'}`);
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
          MCP_PROXY_INSTANCE: this.instanceId
        }
      }
    );

    if (process.env.DEBUG) {
      console.error(`[mcp-hot-reload] Server spawned, PID: ${this.serverProcess.pid}`);
    }

    let eventCount = 0;
    const stdoutHandler = (data: Buffer) => {
      eventCount++;
      if (process.env.DEBUG) {
        const preview = data.toString().substring(0, 50);
        console.error(`[mcp-hot-reload] stdout event #${eventCount}, size: ${data.length}, preview: ${preview}`);
        if (eventCount === 2) {
          // On second event, print stack trace to see where it's coming from
          console.error('[mcp-hot-reload] SECOND EVENT STACK TRACE:');
          console.trace();
        }
      }
      this.handleServerOutput(data);
    };

    if (process.env.DEBUG) {
      console.error(`[mcp-hot-reload] Attaching stdout handler, listeners before: ${this.serverProcess.stdout!.listenerCount('data')}`);
    }
    this.serverProcess.stdout!.on('data', stdoutHandler);
    if (process.env.DEBUG) {
      console.error(`[mcp-hot-reload] Attached stdout handler, listeners after: ${this.serverProcess.stdout!.listenerCount('data')}`);
    }

    this.serverProcess.stderr!.on('data', (data) => {
    });

    this.serverProcess.on('exit', (code, signal) => {
      // Don't restart if we're intentionally stopping
      if (this.isIntentionallyStopping) {
        this.serverProcess = null;
        return;
      }

      if (!this.isRestarting) {
        this.handleServerCrash(
          `Server exited with code ${code}, signal ${signal}`,
          code || 1
        );
      }
    });

    this.serverProcess.on('error', (err) => {
      if (!this.isRestarting) {
        this.handleServerCrash(`Server error: ${err}`, 1);
      }
    });

    await this.waitForServerReady();

    // Only re-send cached initialize during restart, not initial start
    if (this.isRestarting) {
      const initRequest = this.sessionManager.getInitializeRequest();
      fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] After restart - initRequest exists: ${!!initRequest}, isRestarting: ${this.isRestarting}\n`);
      if (process.env.DEBUG) {
        console.error(`[mcp-hot-reload] After waitForServerReady, initRequest exists: ${!!initRequest}, isRestarting: ${this.isRestarting}`);
      }
      if (initRequest && this.serverProcess.stdin?.writable) {
        fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] RE-SENDING CACHED INITIALIZE REQUEST\n`);
        if (process.env.DEBUG) {
          console.error('[mcp-hot-reload] RE-SENDING CACHED INITIALIZE REQUEST (during restart)!');
        }
        this.serverProcess.stdin.write(initRequest);

        await new Promise(resolve => setTimeout(resolve, 100));
      }
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
    // Reset restart attempts on successful start
    this.restartAttempts = 0;
  }

  private async stopServer(): Promise<void> {
    if (!this.serverProcess) return;

    // Mark that we're intentionally stopping to prevent restart
    this.isIntentionallyStopping = true;

    return new Promise((resolve) => {
      const cleanup = () => {
        this.serverProcess?.removeAllListeners();
        this.serverProcess = null;
        this.isIntentionallyStopping = false;
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
    fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] Restarting server...\n`);
    this.isRestarting = true;
    this.metrics.restartCount++;

    try {
      await this.startServer();
      fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] Server restarted successfully\n`);
    } catch (error: any) {
      fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] Server restart failed: ${error}\n`);
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

    // Derive working directory from server args if not explicitly set
    const cwd = this.config.cwd || (
      this.config.serverArgs && this.config.serverArgs.length > 0 && path.isAbsolute(this.config.serverArgs[0])
        ? path.dirname(this.config.serverArgs[0])
        : process.cwd()
    );

    for (const pattern of patterns) {
      const absolutePath = path.isAbsolute(pattern)
        ? pattern
        : path.join(cwd, pattern);

      if (this.isGlobPattern(absolutePath)) {
        // Store the glob pattern for file matching
        this.filePatterns.push(absolutePath);
        // Extract base directory to watch
        targets.add(this.extractDirFromGlob(absolutePath));
      } else {
        // Direct directory - watch all source files
        targets.add(absolutePath);
        // Leave filePatterns empty so shouldWatchFile uses extension checking
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
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**']
    };
  }


  private attachWatcherEventHandlers(): void {
    if (!this.watcher) return;

    this.watcher.on('error', this.logDebug.bind(this, 'Watcher error:'));
    this.watcher.on('add', this.handleFileChange.bind(this));
    this.watcher.on('change', this.handleFileChange.bind(this));
    this.watcher.on('ready', () => {
      fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] Watcher is ready!\n`);
    });
  }

  private async waitForWatcherReady(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.watcher!.once('ready', resolve);
    });
  }

  private shouldWatchFile(filePath: string): boolean {
    // If we have file patterns from config, use them
    if (this.filePatterns.length > 0) {
      const matches = micromatch.isMatch(filePath, this.filePatterns);
      fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] File pattern check: ${filePath} matches patterns ${JSON.stringify(this.filePatterns)}: ${matches}\n`);
      return matches;
    }

    // Default to common source file extensions
    const ext = path.extname(filePath);
    const isSourceFile = [
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
    fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] Extension check: ${filePath} has ext '${ext}', is source file: ${isSourceFile}\n`);
    return isSourceFile;
  }


  private handleServerCrash(reason: string, exitCode: number): void {
    const now = Date.now();
    const timeSinceLastRestart = now - this.lastRestartTime;

    // Reset attempts if enough time has passed
    if (timeSinceLastRestart > this.restartCooldownMs) {
      this.restartAttempts = 0;
    }

    if (this.restartAttempts < this.maxRestartAttempts) {
      this.restartAttempts++;
      this.lastRestartTime = now;
      this.logDebug(`${reason}. Attempting restart (${this.restartAttempts}/${this.maxRestartAttempts})...`);
      this.debounceRestart();
    } else {
      this.logDebug(`Server crashed too many times (${this.maxRestartAttempts}). ${reason}. Exiting...`);
      this.serverProcess = null;
      this.cleanup();
      this.config.onExit(exitCode);
    }
  }

  private logDebug(message: string, ...args: any[]): void {
    if (process.env.DEBUG) {
      console.error(`[MCPHotReload] ${message}`, ...args);
    }
  }

  private handleFileChange(filePath: string): void {
    try {
      fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] File change detected: ${filePath}\n`);

      // Check if we should watch this file type
      if (!this.shouldWatchFile(filePath)) {
        fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] Ignoring file (not watched type): ${filePath}\n`);
        return;
      }

      fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] File changed (processing): ${filePath}\n`);
      console.error('[mcp-hot-reload] File changed:', filePath); // Always log for testing
      this.logDebug('File changed:', filePath);
      this.metrics.fileChangesDetected++;
      this.debounceRestart();
    } catch (error) {
      fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] Error in handleFileChange: ${error}\n`);
      console.error('[mcp-hot-reload] Error handling file change:', error);
    }
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

  private cleanup(removeSignalHandlers = true): void {
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
    // Only remove signal handlers when explicitly requested (not from signal handler itself)
    if (removeSignalHandlers) {
      this.signalHandlers.forEach(({ event, handler }) => {
        process.removeListener(event, handler);
      });
      this.signalHandlers = [];
    }
  }

  public async start(): Promise<void> {
    // If we're already running as a child of ANY proxy, don't start
    // This prevents recursive proxying while allowing multiple proxy instances
    if (process.env.MCP_PROXY_INSTANCE) {
      if (process.env.DEBUG) {
        console.error('[mcp-hot-reload] Skipping start - already running as child of proxy');
      }
      return;
    }

    // Start the server FIRST before setting up stdin
    await this.startServer();
    // await this.setupWatcher();
    // Setup watcher but don't wait for ready event (non-blocking)
    const patterns = this.normalizePatterns(this.config.watchPattern);
    fs.appendFileSync('/tmp/mcp-debug.log', `\n[${new Date().toISOString()}] Watch patterns: ${JSON.stringify(patterns)}\n`);
    if (patterns.length) {
      const watchTargets = this.extractWatchTargets(patterns);
      fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] Watch targets: ${JSON.stringify(watchTargets)}\n`);
      if (watchTargets.length) {
        this.watcher = chokidar.watch(watchTargets, this.getWatcherOptions());
        this.attachWatcherEventHandlers();
        fs.appendFileSync('/tmp/mcp-debug.log', `[${new Date().toISOString()}] Watcher created and handlers attached\n`);
        // Don't wait for ready - that was blocking
      }
    }

    if (process.env.DEBUG) {
      console.error('[mcp-hot-reload] Setting up stdin handler');
    }
    this.stdin.on('data', (data) => {
      if (process.env.DEBUG) {
        console.error('[mcp-hot-reload] Received data:', data.toString().substring(0, 100));
      }
      this.handleIncomingData(data);
    });

    // Handle stdin closure - this means the client disconnected
    this.stdin.on('end', async () => {
      this.logDebug('Client disconnected (stdin closed)');
      await this.stopServer();
      this.cleanup();
      this.config.onExit(0);
    });

    // Keep stdin open
    this.stdin.resume();

    // COMMENTED OUT: Signal handlers for cleanup
    // const signalHandler = async () => {
    //   await this.stopServer();
    //   this.cleanup(false); // Don't remove signal handlers when called from signal
    //   this.config.onExit(0);
    // };

    // process.on('SIGINT', signalHandler);
    // process.on('SIGTERM', signalHandler);

    // this.signalHandlers.push(
    //   { event: 'SIGINT', handler: signalHandler },
    //   { event: 'SIGTERM', handler: signalHandler }
    // );

    this.timeoutInterval = setInterval(() => {
      if (this.isRestarting) {
        this.handleTimeout();
      }
    }, 5000);
    // Allow process to exit even if interval is active
    this.timeoutInterval.unref();
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


