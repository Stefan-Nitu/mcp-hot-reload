import {
  JSONRPCMessage,
  MCPInitializeRequest,
  MCPInitializeResponse,
  MessageBuffer
} from './types.js';

export class SessionManager {
  private initializeRequest: MCPInitializeRequest | null = null;
  private initializeResponse: MCPInitializeResponse | null = null;
  private messageQueue: MessageBuffer[] = [];
  private pendingRequests = new Map<string | number, MessageBuffer>();
  private lastToolsList: any[] = [];
  private isInitialized = false;

  handleClientMessage(message: JSONRPCMessage, raw: string): boolean {
    if (message.method === 'initialize' && message.id) {
      this.initializeRequest = message as MCPInitializeRequest;
      this.isInitialized = false;
      return true;
    }

    // Track all requests with IDs (not just those with methods)
    if (message.id !== undefined && message.id !== null) {
      this.pendingRequests.set(message.id, {
        message,
        timestamp: Date.now(),
        raw
      });
    }

    return this.isInitialized;
  }

  handleServerMessage(message: JSONRPCMessage): void {
    if (this.initializeRequest?.id && message.id === this.initializeRequest.id) {
      this.initializeResponse = message as MCPInitializeResponse;
      this.isInitialized = true;
      this.pendingRequests.delete(message.id);
    }

    if (message.method === 'tools/list' && message.result?.tools) {
      this.lastToolsList = message.result.tools;
    }

    if (message.id && this.pendingRequests.has(message.id)) {
      this.pendingRequests.delete(message.id);
    }
  }

  queueMessage(message: JSONRPCMessage, raw: string): void {
    this.messageQueue.push({
      message,
      timestamp: Date.now(),
      raw
    });
  }

  getQueuedMessages(): MessageBuffer[] {
    const messages = [...this.messageQueue];
    this.messageQueue = [];
    return messages;
  }

  getInitializeRequest(): string | null {
    return this.initializeRequest ? JSON.stringify(this.initializeRequest) + '\n' : null;
  }

  createToolsChangedNotification(): JSONRPCMessage {
    return {
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
      params: {}
    };
  }

  clearPendingRequests(olderThan: number): MessageBuffer[] {
    const now = Date.now();
    const timedOut: MessageBuffer[] = [];

    for (const [id, buffer] of this.pendingRequests.entries()) {
      if (now - buffer.timestamp >= olderThan) {
        timedOut.push(buffer);
        this.pendingRequests.delete(id);
      }
    }

    return timedOut;
  }

  reset(): void {
    this.isInitialized = false;
    this.messageQueue = [];
    this.pendingRequests.clear();
  }

  isSessionInitialized(): boolean {
    return this.isInitialized;
  }
}