import { Readable, Writable } from 'stream';
import { MessageQueue } from './queue.js';
import { SessionTracker } from '../session/tracker.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('message-router');

export class MessageRouter {
  private toMcpServer: Writable | null = null;    // Writable stream TO the MCP server
  private fromMcpServer: Readable | null = null;  // Readable stream FROM the MCP server
  private clientDataHandler: ((data: Buffer) => void) | null = null;
  private serverDataHandler: ((data: Buffer) => void) | null = null;

  constructor(
    private fromMcpClient: Readable,  // Readable stream FROM the MCP client
    private toMcpClient: Writable,    // Writable stream TO the MCP client
    private messageQueue: MessageQueue,
    private sessionTracker: SessionTracker
  ) {
    this.setupClientListener();
  }

  private setupClientListener(): void {
    this.clientDataHandler = (data: Buffer) => {
      const dataStr = data.toString();

      // Let SessionTracker process the data (it returns unchanged data)
      const processedData = this.sessionTracker.processClientData(dataStr);

      // Forward raw data to server or queue
      if (this.toMcpServer?.writable && !this.toMcpServer.destroyed) {
        try {
          this.toMcpServer.write(processedData);
        } catch (error) {
          log.debug('Failed to write to server, queueing message');
          this.messageQueue.add(processedData);
        }
      } else {
        this.messageQueue.add(processedData);
      }
    };

    this.fromMcpClient.on('data', this.clientDataHandler);
  }

  connectServer(toMcpServer: Writable, fromMcpServer: Readable): void {
    log.debug('connectServer called');

    // Disconnect any existing server first
    this.disconnectServer();

    this.toMcpServer = toMcpServer;
    this.fromMcpServer = fromMcpServer;

    // Setup listener for MCP server output
    this.serverDataHandler = (data: Buffer) => {
      const dataStr = data.toString();

      // Let SessionTracker process the data (it returns unchanged data)
      const processedData = this.sessionTracker.processServerData(dataStr);

      // Forward from MCP server to MCP client
      log.debug({ preview: processedData.substring(0, 100) }, 'Forwarding MCP server -> MCP client');
      if (this.toMcpClient.writable && !this.toMcpClient.destroyed) {
        try {
          // Write the original buffer to preserve encoding
          this.toMcpClient.write(data);
        } catch (error) {
          log.debug('Failed to write to MCP client');
        }
      }
    };

    log.debug('Adding server data listener');
    this.fromMcpServer.on('data', this.serverDataHandler);

    // Flush any queued messages
    const queued = this.messageQueue.flush();
    for (const message of queued) {
      if (this.toMcpServer.writable && !this.toMcpServer.destroyed) {
        try {
          this.toMcpServer.write(message);
        } catch (error) {
          log.debug('Failed to flush message to server');
          this.messageQueue.add(message);
        }
      }
    }
  }

  disconnectServer(): void {
    if (this.fromMcpServer && this.serverDataHandler) {
      this.fromMcpServer.removeListener('data', this.serverDataHandler);
    }

    this.toMcpServer = null;
    this.fromMcpServer = null;
    this.serverDataHandler = null;
  }

  stop(): void {
    if (this.clientDataHandler) {
      this.fromMcpClient.removeListener('data', this.clientDataHandler);
    }

    this.disconnectServer();
  }
}