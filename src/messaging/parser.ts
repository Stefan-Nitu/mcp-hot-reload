import { JSONRPCMessage } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('message-parser');

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
          if (process.env.DEBUG) {
            log.warn({ message }, 'Invalid JSON-RPC version');
          }
          continue;
        }
        messages.push(message);
        rawMessages.push(line + '\n');
      } catch (error) {
        // Silently ignore parse errors
      }
    }

    return { messages, rawMessages };
  }

  reset(): void {
    this.partialMessage = '';
  }
}