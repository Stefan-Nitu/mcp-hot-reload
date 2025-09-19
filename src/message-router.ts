import { Readable, Writable } from 'stream';
import { MessageParser } from './message-parser.js';
import { MessageQueue } from './message-queue.js';
import { SessionTracker } from './session-tracker.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('message-router');

export class MessageRouter {
  private messageParser = new MessageParser();
  private serverIn: Writable | null = null;
  private serverOut: Readable | null = null;
  private clientDataHandler: ((data: Buffer) => void) | null = null;
  private serverDataHandler: ((data: Buffer) => void) | null = null;

  constructor(
    private clientIn: Readable,
    private clientOut: Writable,
    private messageQueue: MessageQueue,
    private sessionTracker: SessionTracker
  ) {
    this.setupClientListener();
  }

  private setupClientListener(): void {
    this.clientDataHandler = (data: Buffer) => {
      const dataStr = data.toString();

      // Always forward raw data to server or queue
      if (this.serverIn?.writable && !this.serverIn.destroyed) {
        try {
          this.serverIn.write(dataStr);
        } catch (error) {
          log.debug('Failed to write to server, queueing message');
          this.messageQueue.add(dataStr);
        }
      } else {
        this.messageQueue.add(dataStr);
      }

      // Try to parse for tracking
      const { messages, rawMessages } = this.messageParser.parseMessages(dataStr);
      messages.forEach((message, index) => {
        const raw = rawMessages[index];

        // Track initialize messages
        if (message.method === 'initialize') {
          this.sessionTracker.trackInitializeRequest(message, raw);
        }
      });
    };

    this.clientIn.on('data', this.clientDataHandler);
  }

  connectServer(serverIn: Writable, serverOut: Readable): void {
    log.debug('connectServer called');

    // Disconnect any existing server first
    this.disconnectServer();

    this.serverIn = serverIn;
    this.serverOut = serverOut;

    // Setup server output listener
    this.serverDataHandler = (data: Buffer) => {
      // Forward to client
      log.debug({ preview: data.toString().substring(0, 100) }, 'Forwarding server->client');
      if (this.clientOut.writable && !this.clientOut.destroyed) {
        try {
          this.clientOut.write(data);
        } catch (error) {
          log.debug('Failed to write to client');
        }
      }

      // Track initialize responses
      const { messages } = this.messageParser.parseMessages(data.toString());
      messages.forEach(message => {
        if (message.id && message.result) {
          this.sessionTracker.trackInitializeResponse(message);
        }
      });
    };

    log.debug('Adding server data listener');
    this.serverOut.on('data', this.serverDataHandler);

    // Flush any queued messages
    const queued = this.messageQueue.flush();
    for (const message of queued) {
      if (this.serverIn.writable && !this.serverIn.destroyed) {
        try {
          this.serverIn.write(message);
        } catch (error) {
          log.debug('Failed to flush message to server');
          this.messageQueue.add(message);
        }
      }
    }
  }

  disconnectServer(): void {
    if (this.serverOut && this.serverDataHandler) {
      this.serverOut.removeListener('data', this.serverDataHandler);
    }

    this.serverIn = null;
    this.serverOut = null;
    this.serverDataHandler = null;
  }

  stop(): void {
    if (this.clientDataHandler) {
      this.clientIn.removeListener('data', this.clientDataHandler);
    }

    this.disconnectServer();
  }
}