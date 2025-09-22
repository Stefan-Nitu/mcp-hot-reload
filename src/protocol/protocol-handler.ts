import { Readable, Writable } from 'stream';
import { ServerConnection } from '../process/server-connection.js';
import { MessageParser } from '../messaging/parser.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('protocol-handler');

interface SessionState {
  initialized: boolean;
  initializeRequest: string | null;
  pendingRequest: { id: any; method: string } | null;
}

// Keep it simple - just what we need
interface ParsedMessage {
  id?: any;
  method?: string;
  result?: any;
  error?: any;
  raw: string;
}

interface QueuedMessage {
  message: ParsedMessage;
  priority: number;
}

/**
 * Unified protocol handler that integrates messaging and session management.
 * Session state DRIVES routing decisions, not just observes.
 */
export class ProtocolHandler {
  private session: SessionState = {
    initialized: false,
    initializeRequest: null,
    pendingRequest: null
  };

  private serverConnection: ServerConnection | null = null;
  private parser = new MessageParser();
  private messageQueue: QueuedMessage[] = [];
  private partialMessage = '';

  // Event handlers
  private clientDataHandler: ((data: Buffer) => void) | null = null;
  private serverDataHandler: ((data: Buffer) => void) | null = null;

  constructor(
    private clientIn: Readable,
    private clientOut: Writable
  ) {
    this.setupClientListener();
  }

  private setupClientListener(): void {
    this.clientDataHandler = (data: Buffer) => {
      this.handleClientData(data);
    };
    this.clientIn.on('data', this.clientDataHandler);
  }

  private handleClientData(data: Buffer): void {
    const dataStr = data.toString();

    // Handle potential partial messages
    const fullData = this.partialMessage + dataStr;
    const lines = fullData.split('\n');

    // If data ends with newline, last element will be empty string
    // Otherwise, it's a partial message to keep for next chunk
    if (lines[lines.length - 1] === '') {
      // Complete messages only
      this.partialMessage = '';
      lines.pop(); // Remove empty string
    } else {
      // Keep last incomplete line as partial
      this.partialMessage = lines[lines.length - 1];
      lines.pop(); // Remove partial from processing
    }

    // Process complete messages
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      this.handleClientMessage(trimmed + '\n');
    }
  }

  private handleClientMessage(rawMessage: string): void {
    // Parse message
    let message: ParsedMessage;
    try {
      const parsed = JSON.parse(rawMessage.trim());
      message = {
        ...parsed,
        raw: rawMessage
      };
    } catch (error) {
      // Malformed JSON - still forward but can't process
      log.debug({ error, rawMessage }, 'Failed to parse message');
      message = { raw: rawMessage };
    }

    // Track session state
    this.updateSessionStateFromClient(message);

    // Session state DRIVES routing decision
    if (!this.serverConnection || !this.serverConnection.isAlive()) {
      // No server - queue everything
      this.queueWithPriority(message);
    } else if (!this.session.initialized && message.method && message.method !== 'initialize') {
      // Queue non-initialize messages until initialized
      this.queueWithPriority(message);
    } else {
      // Forward to server
      this.forwardToServer(message);
    }
  }

  private updateSessionStateFromClient(message: ParsedMessage): void {
    // Track pending requests
    if (message.id !== undefined && message.method) {
      this.session.pendingRequest = {
        id: message.id,
        method: message.method
      };
      log.debug({ id: message.id, method: message.method }, 'Tracking pending request');
    }

    // Track initialize request
    if (message.method === 'initialize' && message.id !== undefined) {
      this.session.initializeRequest = message.raw;
      this.session.initialized = false;
      log.debug('Tracked initialize request');
    }
  }

  private forwardToServer(message: ParsedMessage): void {
    if (!this.serverConnection?.stdin?.writable) {
      this.queueWithPriority(message);
      return;
    }

    try {
      this.serverConnection.stdin.write(message.raw);
    } catch (error) {
      log.debug({ error }, 'Failed to write to server, queueing');
      this.queueWithPriority(message);
    }
  }

  private queueWithPriority(message: ParsedMessage): void {
    const priority = this.getMessagePriority(message);
    this.messageQueue.push({ message, priority });

    // Keep queue sorted by priority (higher priority first)
    this.messageQueue.sort((a, b) => b.priority - a.priority);
  }

  private getMessagePriority(message: ParsedMessage): number {
    if (message.method === 'initialize') return 100;  // Highest
    if (message.id !== undefined) return 50;          // Regular requests
    return 10;                                         // Notifications (lowest)
  }

  connectServer(connection: ServerConnection): void {
    log.debug('connectServer called');

    // CRITICAL: Disconnect old server first (no duplicates!)
    this.disconnectServer();

    this.serverConnection = connection;

    // Setup server output listener
    this.serverDataHandler = (data: Buffer) => {
      this.handleServerData(data);
    };

    log.debug('Adding server data listener');
    connection.stdout.on('data', this.serverDataHandler);

    // Handle stream errors gracefully
    connection.stdout.on('error', (error) => {
      log.error({ error }, 'Server stdout stream error');
      // Don't crash - continue operating
    });

    connection.stdin.on('error', (error) => {
      log.error({ error }, 'Server stdin stream error');
      // Don't crash - continue operating
    });

    // Setup crash monitoring
    this.setupCrashMonitoring(connection);

    // Handle initialization for new server connection
    if (this.session.initializeRequest) {
      // Always send initialize to new server connection
      // The server needs initialization regardless of our internal state
      try {
        connection.stdin.write(this.session.initializeRequest);
        log.debug('Sent initialize request to establish session with server');

        // Mark as not initialized since we're waiting for response from new server
        this.session.initialized = false;
      } catch (error) {
        log.error({ error }, 'Failed to send initialize');
      }
    }

    // Flush queued messages in priority order (after initialize)
    this.flushQueue();
  }

  private setupCrashMonitoring(connection: ServerConnection): void {
    connection.waitForCrash().then(({ code, signal }) => {
      log.info({ code, signal }, 'Server process terminated');
      this.handleServerCrash(code, signal);
    }).catch(error => {
      log.error({ error }, 'Error monitoring server crash');
    });
  }

  private handleServerData(data: Buffer): void {
    const dataStr = data.toString();

    // Parse response to track session state
    try {
      const lines = dataStr.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;

        const response = JSON.parse(line);
        this.updateSessionStateFromServer(response);
      }
    } catch (error) {
      log.debug({ error }, 'Failed to parse server response');
    }

    // Forward to client
    if (this.clientOut.writable && !(this.clientOut as any).destroyed) {
      try {
        this.clientOut.write(data);
      } catch (error) {
        log.error({ error }, 'Failed to write to client');
      }
    }
  }

  private updateSessionStateFromServer(response: any): void {
    // Clear pending request on response
    if (this.session.pendingRequest && response.id === this.session.pendingRequest.id) {
      log.debug({ id: response.id }, 'Clearing pending request');
      this.session.pendingRequest = null;
    }

    // Mark initialized on successful initialize response
    if (response.id !== undefined && response.result && !this.session.initialized) {
      // Check if this is response to our initialize
      try {
        const initReq = JSON.parse(this.session.initializeRequest || '{}');
        if (initReq.id === response.id) {
          this.session.initialized = true;
          log.debug('Session initialized');

          // Flush any queued messages now that we're initialized
          this.flushQueue();
        }
      } catch (error) {
        // Ignore parse errors
      }
    }
  }

  private flushQueue(): void {
    if (!this.serverConnection?.stdin?.writable) return;

    const toSend = [...this.messageQueue];
    this.messageQueue = [];

    // Sort by priority one more time to be sure (higher priority first)
    toSend.sort((a, b) => b.priority - a.priority);

    for (const { message } of toSend) {
      try {
        this.serverConnection.stdin.write(message.raw);
      } catch (error) {
        log.debug({ error }, 'Failed to flush message');
        // Re-queue failed message
        this.messageQueue.push({ message, priority: this.getMessagePriority(message) });
      }
    }
  }

  disconnectServer(): void {
    if (this.serverConnection) {
      // Remove listeners
      if (this.serverDataHandler) {
        this.serverConnection.stdout.removeListener('data', this.serverDataHandler);
      }

      // Dispose connection
      this.serverConnection.dispose();
      this.serverConnection = null;
    }
  }

  handleServerCrash(code: number | null, signal: NodeJS.Signals | null): void {
    // Send error response for pending request
    if (this.session.pendingRequest) {
      const errorMessage = this.buildCrashErrorMessage(code, signal);
      const errorResponse = {
        jsonrpc: '2.0',
        id: this.session.pendingRequest.id,
        error: {
          code: -32603,
          message: errorMessage,
          data: {
            exitCode: code,
            signal: signal,
            method: this.session.pendingRequest.method,
            info: 'Save a file to trigger rebuild and restart, or check server logs for crash details.'
          }
        }
      };

      try {
        if (this.clientOut.writable && !(this.clientOut as any).destroyed) {
          this.clientOut.write(JSON.stringify(errorResponse) + '\n');
          this.session.pendingRequest = null;
        }
      } catch (error) {
        log.error({ error }, 'Failed to send crash error to client');
      }
    }

    // Disconnect crashed server
    this.disconnectServer();
  }

  private buildCrashErrorMessage(code: number | null, signal: NodeJS.Signals | null): string {
    let errorMessage = 'MCP server process terminated unexpectedly';

    if (signal === 'SIGSEGV') {
      errorMessage += ' (segmentation fault - possible memory access violation)';
    } else if (signal === 'SIGKILL') {
      errorMessage += ' (killed forcefully - possible out of memory or manual termination)';
    } else if (signal === 'SIGTERM') {
      errorMessage += ' (terminated - process shutdown requested)';
    } else if (signal === 'SIGINT') {
      errorMessage += ' (interrupted - Ctrl+C or similar)';
    } else if (signal) {
      errorMessage += ` (signal: ${signal})`;
    } else if (code === 1) {
      errorMessage += ' (exit code 1 - general error, check server logs)';
    } else if (code === 127) {
      errorMessage += ' (exit code 127 - command not found)';
    } else if (code === 130) {
      errorMessage += ' (exit code 130 - terminated by Ctrl+C)';
    } else if (code === 137) {
      errorMessage += ' (exit code 137 - killed, possibly out of memory)';
    } else if (code === 143) {
      errorMessage += ' (exit code 143 - terminated by SIGTERM)';
    } else if (code !== null && code !== 0) {
      errorMessage += ` (exit code ${code})`;
    }

    errorMessage += '. Hot-reload will attempt to restart on next file change.';
    return errorMessage;
  }

  getSessionState(): SessionState {
    return { ...this.session };
  }

  getQueueSize(): number {
    return this.messageQueue.length;
  }

  shutdown(): void {
    // Clean up everything
    this.disconnectServer();

    // Remove client listener
    if (this.clientDataHandler) {
      this.clientIn.removeListener('data', this.clientDataHandler);
    }

    // Reset state
    this.session = {
      initialized: false,
      initializeRequest: null,
      pendingRequest: null
    };
    this.messageQueue = [];
    this.partialMessage = '';
  }

  // Global error handlers (called from index.ts handlers)
  handleUncaughtError(error: Error): void {
    log.error({ error }, 'Uncaught error in protocol handler');
    // Don't crash - try to continue operating
  }

  handleUnhandledRejection(error: Error): void {
    log.error({ error }, 'Unhandled rejection in protocol handler');
    // Don't crash - try to continue operating
  }

  handleStdinEnd(): void {
    log.info('Stdin ended, shutting down');
    this.shutdown();
  }
}