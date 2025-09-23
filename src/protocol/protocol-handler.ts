import { Readable, Writable } from 'stream';
import { ServerConnection } from '../process/server-connection.js';
import { createLogger } from '../utils/logger.js';
import { translateExitCondition } from '../utils/exit-code-translator.js';
import { PriorityMessageQueue } from '../messaging/priority-queue.js';
import { MessageBuffer } from '../messaging/message-buffer.js';
import type { ParsedMessage } from '../types/mcp-types.js';

const log = createLogger('protocol-handler');

interface SessionState {
  initialized: boolean;
  initializeRequest: string | null;
  pendingRequest: { id: any; method: string } | null;
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
  private serverCrashed: boolean = false;
  private lastCrashCode: number | null = null;
  private lastCrashSignal: NodeJS.Signals | null = null;

  private serverConnection: ServerConnection | null = null;
  private messageQueue = new PriorityMessageQueue();
  private clientBuffer = new MessageBuffer();
  private serverBuffer = new MessageBuffer();

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
    const messages = this.clientBuffer.append(data.toString());

    // Process complete messages
    for (const message of messages) {
      this.handleClientMessage(message);
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
    // Check crash state first for requests
    if (this.serverCrashed && message.id !== undefined) {
      // Server has crashed - send error response for requests
      this.sendCrashErrorResponse(message.id, message.method || 'unknown', false);
    } else if ((!this.serverConnection || !this.serverConnection.isAlive()) && message.method !== 'initialize') {
      // No server - queue non-initialize messages (initialize is stored separately for replay)
      this.queueWithPriority(message);
    } else if (!this.session.initialized && message.method && message.method !== 'initialize') {
      // Queue non-initialize messages until initialized
      this.queueWithPriority(message);
    } else if (this.serverConnection && this.serverConnection.isAlive()) {
      // Forward to server if connected
      this.forwardToServer(message);
    }
    // If no server and it's initialize, do nothing (already stored in session)
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
    this.messageQueue.add(message);
  }

  connectServer(connection: ServerConnection): void {
    log.debug('connectServer called');

    // CRITICAL: Disconnect old server first (no duplicates!)
    this.disconnectServer();

    this.serverConnection = connection;
    this.serverCrashed = false; // Reset crash state on new connection
    this.lastCrashCode = null;
    this.lastCrashSignal = null;

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
    // Forward to client immediately
    if (this.clientOut.writable && !(this.clientOut as any).destroyed) {
      try {
        this.clientOut.write(data);
      } catch (error) {
        log.error({ error }, 'Failed to write to client');
      }
    }

    // Also parse to track session state
    const messages = this.serverBuffer.append(data.toString());
    for (const message of messages) {
      try {
        const response = JSON.parse(message.trim());
        this.updateSessionStateFromServer(response);
      } catch (error) {
        log.debug({ error }, 'Failed to parse server response');
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

    const messages = this.messageQueue.flush();

    for (const message of messages) {
      try {
        this.serverConnection.stdin.write(message.raw);
      } catch (error) {
        log.debug({ error }, 'Failed to flush message');
        // Re-queue failed message
        this.messageQueue.add(message);
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
    // Store crash info for future requests
    this.serverCrashed = true;
    this.lastCrashCode = code;
    this.lastCrashSignal = signal;

    // Send error response for pending request
    if (this.session.pendingRequest) {
      this.sendCrashErrorResponse(
        this.session.pendingRequest.id,
        this.session.pendingRequest.method,
        true  // This is the initial crash notification
      );
      this.session.pendingRequest = null;
    }

    // Disconnect crashed server
    this.disconnectServer();
  }

  private sendCrashErrorResponse(id: string | number, method: string, isInitialCrash: boolean = false): void {
    const errorMessage = isInitialCrash
      ? this.buildCrashErrorMessage(this.lastCrashCode, this.lastCrashSignal)
      : `MCP server is not running (crashed earlier with ${translateExitCondition(this.lastCrashCode, this.lastCrashSignal)}). Hot-reload will attempt to restart on next file change.`;

    const errorResponse = {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: errorMessage,
        data: {
          exitCode: this.lastCrashCode,
          signal: this.lastCrashSignal,
          method,
          info: 'Save a file to trigger rebuild and restart, or check server logs for crash details.'
        }
      }
    };

    try {
      if (this.clientOut.writable && !(this.clientOut as any).destroyed) {
        this.clientOut.write(JSON.stringify(errorResponse) + '\n');
      }
    } catch (error) {
      log.error({ error }, 'Failed to send crash error to client');
    }
  }

  private buildCrashErrorMessage(code: number | null, signal: NodeJS.Signals | null): string {
    const exitCondition = translateExitCondition(code, signal);
    return `MCP server process terminated unexpectedly (${exitCondition}). Hot-reload will attempt to restart on next file change.`;
  }

  getSessionState(): SessionState {
    return { ...this.session };
  }

  getQueueSize(): number {
    return this.messageQueue.size();
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
    this.messageQueue.clear();
    this.clientBuffer.clear();
    this.serverBuffer.clear();
  }
}