import { MessageParser } from '../messaging/parser.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('session-tracker');

export class SessionTracker {
  private initializeRequestRaw: string | null = null;
  private initializeRequestId: string | number | null = null;
  private initialized = false;
  private readonly messageParser: MessageParser;
  private pendingRequest: { id: string | number; method: string } | null = null;

  constructor(messageParser: MessageParser) {
    this.messageParser = messageParser;
  }

  /**
   * Process data from client to track initialize requests
   * Returns the raw data unchanged for forwarding
   */
  processClientData(data: string): string {
    const { messages, rawMessages } = this.messageParser.parseMessages(data);

    messages.forEach((message, index) => {
      // Track any request with an ID (not notifications)
      if (message.id && message.method) {
        this.pendingRequest = { id: message.id, method: message.method };
        log.debug({ requestId: message.id, method: message.method }, 'Tracking pending request');
      }

      if (message.method === 'initialize' && message.id) {
        this.initializeRequestRaw = rawMessages[index];
        this.initializeRequestId = message.id;
        this.initialized = false;
        log.debug({ requestId: message.id }, 'Tracked initialize request');
      }
    });

    return data; // Return unchanged for forwarding
  }

  /**
   * Process data from server to track initialize responses
   * Returns the raw data unchanged for forwarding
   */
  processServerData(data: string): string {
    const { messages } = this.messageParser.parseMessages(data);

    messages.forEach(message => {
      // Clear pending request when we get a response
      if (this.pendingRequest && message.id === this.pendingRequest.id) {
        log.debug({ requestId: message.id }, 'Received response, clearing pending request');
        this.pendingRequest = null;
      }

      if (message.id === this.initializeRequestId && message.result) {
        this.initialized = true;
        log.debug({ requestId: message.id }, 'Session initialized');
      }
    });

    return data; // Return unchanged for forwarding
  }

  getInitializeRequest(): string | null {
    return this.initializeRequestRaw;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  reset(): void {
    this.initializeRequestRaw = null;
    this.initializeRequestId = null;
    this.initialized = false;
    this.pendingRequest = null;
  }

  getPendingRequest(): { id: string | number; method: string } | null {
    return this.pendingRequest;
  }

  clearPendingRequest(): void {
    this.pendingRequest = null;
  }
}