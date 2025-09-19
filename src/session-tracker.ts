import { JSONRPCMessage } from './types.js';

export class SessionTracker {
  private initializeRequestRaw: string | null = null;
  private initializeRequestId: string | number | null = null;
  private initialized = false;

  trackInitializeRequest(message: JSONRPCMessage, raw: string): void {
    if (message.method === 'initialize' && message.id) {
      this.initializeRequestRaw = raw;
      this.initializeRequestId = message.id;
      this.initialized = false;
    }
  }

  trackInitializeResponse(message: JSONRPCMessage): void {
    if (message.id === this.initializeRequestId && message.result) {
      this.initialized = true;
    }
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