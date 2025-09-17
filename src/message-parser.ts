import { JSONRPCMessage } from './types.js';

export class MessageParser {
  private partialMessage = '';

  parseMessages(data: string): { messages: JSONRPCMessage[], rawMessages: string[] } {
    const text = this.partialMessage + data;
    const lines = text.split('\n');

    this.partialMessage = lines.pop() || '';

    const messages: JSONRPCMessage[] = [];
    const rawMessages: string[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line) as JSONRPCMessage;
        if (message.jsonrpc !== '2.0') {
          console.error('[dev-proxy] Invalid JSON-RPC version:', message);
          continue;
        }
        messages.push(message);
        rawMessages.push(line + '\n');
      } catch (error) {
        console.error('[dev-proxy] Failed to parse JSON-RPC message:', line, error);
      }
    }

    return { messages, rawMessages };
  }

  reset(): void {
    this.partialMessage = '';
  }
}