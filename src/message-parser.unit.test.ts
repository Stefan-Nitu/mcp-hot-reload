import { describe, it, expect, beforeEach } from '@jest/globals';
import { MessageParser } from './message-parser.js';

describe('MessageParser', () => {
  let parser: MessageParser;

  beforeEach(() => {
    parser = new MessageParser();
  });

  describe('parseMessages', () => {
    it('should parse complete JSON-RPC messages', () => {
      // Arrange
      const data = '{"jsonrpc":"2.0","method":"test","id":1}\n';

      // Act
      const { messages, rawMessages } = parser.parseMessages(data);

      // Assert
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        jsonrpc: '2.0',
        method: 'test',
        id: 1
      });
      expect(rawMessages).toHaveLength(1);
      expect(rawMessages[0]).toBe('{"jsonrpc":"2.0","method":"test","id":1}\n');
    });

    it('should handle partial messages correctly', () => {
      // Arrange
      const part1 = '{"jsonrpc":"2.0",';
      const part2 = '"method":"test","id":1}\n';

      // Act
      const result1 = parser.parseMessages(part1);
      const result2 = parser.parseMessages(part2);

      // Assert
      expect(result1.messages).toHaveLength(0);
      expect(result2.messages).toHaveLength(1);
      expect(result2.messages[0].method).toBe('test');
    });

    it('should handle multiple messages in one chunk', () => {
      // Arrange
      const data = '{"jsonrpc":"2.0","method":"test1","id":1}\n' +
                   '{"jsonrpc":"2.0","method":"test2","id":2}\n';

      // Act
      const { messages } = parser.parseMessages(data);

      // Assert
      expect(messages).toHaveLength(2);
      expect(messages[0].method).toBe('test1');
      expect(messages[1].method).toBe('test2');
    });

    it('should ignore empty lines', () => {
      // Arrange
      const data = '{"jsonrpc":"2.0","method":"test","id":1}\n\n' +
                   '{"jsonrpc":"2.0","method":"test2","id":2}\n';

      // Act
      const { messages } = parser.parseMessages(data);

      // Assert
      expect(messages).toHaveLength(2);
    });

    it('should reject invalid JSON-RPC version', () => {
      // Arrange
      const data = '{"jsonrpc":"1.0","method":"test","id":1}\n';

      // Act
      const { messages } = parser.parseMessages(data);

      // Assert
      expect(messages).toHaveLength(0);
    });

    it('should skip invalid JSON lines and parse valid ones', () => {
      // Arrange
      const data = '{invalid json}\n{"jsonrpc":"2.0","method":"test","id":1}\n';

      // Act
      const { messages } = parser.parseMessages(data);

      // Assert
      expect(messages).toHaveLength(1);
      expect(messages[0].method).toBe('test');
    });
  });

  describe('reset', () => {
    it('should clear partial message buffer', () => {
      // Arrange
      parser.parseMessages('{"jsonrpc":"2.0",');

      // Act
      parser.reset();
      const { messages } = parser.parseMessages('"method":"test","id":1}\n');

      // Assert
      expect(messages).toHaveLength(0);
    });
  });
});