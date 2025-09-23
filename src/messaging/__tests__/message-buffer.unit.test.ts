import { describe, it, expect, beforeEach } from 'vitest';
import { MessageBuffer } from '../message-buffer.js';

describe('MessageBuffer', () => {
  let buffer: MessageBuffer;

  beforeEach(() => {
    buffer = new MessageBuffer();
  });

  describe('append', () => {
    it('should extract complete messages ending with newline', () => {
      // Arrange
      const data = '{"jsonrpc":"2.0","method":"test","id":1}\n';

      // Act
      const messages = buffer.append(data);

      // Assert
      expect(messages).toHaveLength(1);
      expect(messages[0]).toBe('{"jsonrpc":"2.0","method":"test","id":1}\n');
    });

    it('should handle partial messages across multiple appends', () => {
      // Arrange
      const part1 = '{"jsonrpc":"2.0",';
      const part2 = '"method":"test","id":1}\n';

      // Act
      const messages1 = buffer.append(part1);
      const messages2 = buffer.append(part2);

      // Assert
      expect(messages1).toHaveLength(0); // No complete message yet
      expect(messages2).toHaveLength(1); // Now we have a complete message
      expect(messages2[0]).toBe('{"jsonrpc":"2.0","method":"test","id":1}\n');
    });

    it('should extract multiple messages from single chunk', () => {
      // Arrange
      const data = '{"jsonrpc":"2.0","method":"test1","id":1}\n' +
                   '{"jsonrpc":"2.0","method":"test2","id":2}\n';

      // Act
      const messages = buffer.append(data);

      // Assert
      expect(messages).toHaveLength(2);
      expect(messages[0]).toBe('{"jsonrpc":"2.0","method":"test1","id":1}\n');
      expect(messages[1]).toBe('{"jsonrpc":"2.0","method":"test2","id":2}\n');
    });

    it('should ignore empty lines between messages', () => {
      // Arrange
      const data = '{"jsonrpc":"2.0","method":"test1","id":1}\n\n' +
                   '{"jsonrpc":"2.0","method":"test2","id":2}\n';

      // Act
      const messages = buffer.append(data);

      // Assert
      expect(messages).toHaveLength(2);
      expect(messages[0]).toBe('{"jsonrpc":"2.0","method":"test1","id":1}\n');
      expect(messages[1]).toBe('{"jsonrpc":"2.0","method":"test2","id":2}\n');
    });

    it('should handle data without trailing newline as partial', () => {
      // Arrange
      const data = '{"jsonrpc":"2.0","method":"test","id":1}';

      // Act
      const messages = buffer.append(data);

      // Assert
      expect(messages).toHaveLength(0);
      expect(buffer.hasPartial()).toBe(true);
      expect(buffer.getPartial()).toBe('{"jsonrpc":"2.0","method":"test","id":1}');
    });

    it('should handle mixed complete and partial messages', () => {
      // Arrange
      const data = '{"jsonrpc":"2.0","method":"complete","id":1}\n' +
                   '{"jsonrpc":"2.0","method":"partial"';

      // Act
      const messages = buffer.append(data);

      // Assert
      expect(messages).toHaveLength(1);
      expect(messages[0]).toBe('{"jsonrpc":"2.0","method":"complete","id":1}\n');
      expect(buffer.hasPartial()).toBe(true);
      expect(buffer.getPartial()).toBe('{"jsonrpc":"2.0","method":"partial"');
    });

    it('should handle empty string gracefully', () => {
      // Arrange & Act
      const messages = buffer.append('');

      // Assert
      expect(messages).toHaveLength(0);
      expect(buffer.hasPartial()).toBe(false);
    });

    it('should handle newline-only input', () => {
      // Arrange & Act
      const messages = buffer.append('\n');

      // Assert
      expect(messages).toHaveLength(0);
    });

    it('should complete partial message from previous append', () => {
      // Arrange
      buffer.append('{"jsonrpc":"2.0",'); // Start partial

      // Act
      const messages = buffer.append('"method":"test"}\n');

      // Assert
      expect(messages).toHaveLength(1);
      expect(messages[0]).toBe('{"jsonrpc":"2.0","method":"test"}\n');
      expect(buffer.hasPartial()).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear partial message buffer', () => {
      // Arrange
      buffer.append('{"jsonrpc":"2.0",'); // Create partial
      expect(buffer.hasPartial()).toBe(true);

      // Act
      buffer.clear();

      // Assert
      expect(buffer.hasPartial()).toBe(false);
      expect(buffer.getPartial()).toBe('');
    });

    it('should not return previous partial after clear', () => {
      // Arrange
      buffer.append('{"jsonrpc":"2.0",'); // Create partial
      buffer.clear();

      // Act - Try to complete what would have been the partial
      const messages = buffer.append('"method":"test"}\n');

      // Assert - Returns as a new message (buffer doesn't validate JSON)
      expect(messages).toHaveLength(1);
      expect(messages[0]).toBe('"method":"test"}\n');
      expect(buffer.hasPartial()).toBe(false);
    });
  });

  describe('hasPartial', () => {
    it('should return false initially', () => {
      expect(buffer.hasPartial()).toBe(false);
    });

    it('should return true when partial message exists', () => {
      // Arrange & Act
      buffer.append('{"partial":');

      // Assert
      expect(buffer.hasPartial()).toBe(true);
    });

    it('should return false after partial is completed', () => {
      // Arrange
      buffer.append('{"test":');
      buffer.append('"value"}\n');

      // Assert
      expect(buffer.hasPartial()).toBe(false);
    });
  });

  describe('getPartial', () => {
    it('should return empty string initially', () => {
      expect(buffer.getPartial()).toBe('');
    });

    it('should return current partial message', () => {
      // Arrange & Act
      buffer.append('{"incomplete":true');

      // Assert
      expect(buffer.getPartial()).toBe('{"incomplete":true');
    });
  });
});