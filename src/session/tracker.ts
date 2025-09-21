import { MessageParser } from '../messaging/parser.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('session-tracker');

export class SessionTracker {
  private initializeRequestRaw: string | null = null;
  private initializeRequestId: string | number | null = null;
  private initialized = false;
  private readonly messageParser: MessageParser;

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
  }
}