#!/usr/bin/env node
import { spawn, ChildProcess, execSync } from 'child_process';
import { watch, FSWatcher } from 'fs';
import { Readable, Writable } from 'stream';
import { MessageParser } from './message-parser.js';
import { SessionManager } from './session-manager.js';
import { ProxyConfig, JSONRPCMessage } from './types.js';

export class MCPHotReload {
  private serverProcess: ChildProcess | null = null;
  private watchers: FSWatcher[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private timeoutInterval: NodeJS.Timeout | null = null;
  private messageParser = new MessageParser();
  private sessionManager = new SessionManager();
  private isRestarting = false;
  private config: Required<ProxyConfig>;

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
        this.stderr.write(`[mcp-hot-reload] Buffered message: ${message.method || 'response'}\n`);
      } else {
        const shouldForward = this.sessionManager.handleClientMessage(message, raw);

        if (shouldForward && this.serverProcess?.stdin?.writable) {
          this.serverProcess.stdin.write(raw);
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
    this.stderr.write('[mcp-hot-reload] Starting server...\n');

    if (this.serverProcess) {
      await this.stopServer();
    }

    // Run build command before starting server
    try {
      this.stderr.write('[mcp-hot-reload] Running build...\n');
      execSync(this.config.buildCommand, {
        stdio: ['ignore', 'ignore', 'pipe'],
        encoding: 'utf8',
        cwd: this.config.cwd
      });
      this.stderr.write('[mcp-hot-reload] Build complete\n');
    } catch (error: any) {
      this.stderr.write(`[mcp-hot-reload] Build failed: ${error.message}\n`);
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
      this.stderr.write(data);
    });

    this.serverProcess.on('exit', (code, signal) => {
      if (!this.isRestarting) {
        this.stderr.write(`[mcp-hot-reload] Server exited (code: ${code}, signal: ${signal})\n`);
        this.cleanup();
        this.config.onExit(code || 0);
      }
    });

    this.serverProcess.on('error', (err) => {
      this.stderr.write(`[mcp-hot-reload] Server error: ${err.message}\n`);
      if (!this.isRestarting) {
        this.cleanup();
        this.config.onExit(1);
      }
    });

    await this.waitForServerReady();

    const initRequest = this.sessionManager.getInitializeRequest();
    if (initRequest && this.serverProcess.stdin?.writable) {
      this.stderr.write('[mcp-hot-reload] Re-sending initialize request\n');
      this.serverProcess.stdin.write(initRequest);

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const queuedMessages = this.sessionManager.getQueuedMessages();
    if (queuedMessages.length > 0) {
      this.stderr.write(`[mcp-hot-reload] Replaying ${queuedMessages.length} buffered messages\n`);
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
      this.stderr.write('[mcp-hot-reload] Sent tools/list_changed notification\n');
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
    this.stderr.write('[mcp-hot-reload] Change detected, restarting...\n');
    this.isRestarting = true;

    try {
      await this.startServer();
    } catch (error: any) {
      this.stderr.write(`[mcp-hot-reload] Restart failed: ${error.message}\n`);
      this.isRestarting = false;
    }
  }

  private setupWatcher(): void {
    const patterns = Array.isArray(this.config.watchPattern)
      ? this.config.watchPattern
      : [this.config.watchPattern];

    patterns.forEach(pattern => {
      const watcher = watch(pattern, { recursive: true });

      watcher.on('change', (_eventType, filename) => {
        const filenameStr = filename?.toString();
        if (filenameStr && (filenameStr.endsWith('.ts') || filenameStr.endsWith('.js'))) {
          if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
          }
          this.debounceTimer = setTimeout(() => {
            this.restartServer();
          }, this.config.debounceMs);
        }
      });

      this.watchers.push(watcher);
      this.stderr.write(`[mcp-hot-reload] Watching ${pattern} for changes...\n`);
    });
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
    this.watchers.forEach(watcher => watcher.close());
    this.watchers = [];
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
      this.stderr.write('[mcp-hot-reload] Shutting down...\n');
      await this.stopServer();
      this.cleanup();
      this.config.onExit(0);
    });

    process.on('SIGTERM', async () => {
      this.stderr.write('[mcp-hot-reload] Shutting down...\n');
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
    this.setupWatcher();
  }

  public async stop(): Promise<void> {
    await this.stopServer();
    this.cleanup();
  }
}

if (require.main === module) {
  const proxy = new MCPHotReload();
  proxy.start();
}