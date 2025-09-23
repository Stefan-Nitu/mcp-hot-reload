import { describe, it, expect, beforeEach } from 'vitest';
import { PriorityMessageQueue } from '../priority-queue.js';
import type { ParsedMessage } from '../../types/mcp-types.js';

describe('PriorityMessageQueue', () => {
  let queue: PriorityMessageQueue;

  beforeEach(() => {
    queue = new PriorityMessageQueue();
  });

  describe('add', () => {
    it('should add messages to queue', () => {
      // Arrange
      const msg1: ParsedMessage = { raw: 'msg1' };
      const msg2: ParsedMessage = { raw: 'msg2' };

      // Act
      queue.add(msg1);
      queue.add(msg2);

      // Assert
      expect(queue.size()).toBe(2);
    });
  });

  describe('flush', () => {
    it('should return all messages sorted by priority', () => {
      // Arrange - Add messages with different priorities
      const initMessage: ParsedMessage = {
        method: 'initialize',
        id: 1,
        raw: 'init'
      };
      const toolMessage: ParsedMessage = {
        method: 'tools/call',
        id: 2,
        raw: 'tool'
      };
      const regularMessage: ParsedMessage = {
        method: 'other',
        id: 3,
        raw: 'regular'
      };
      const notification: ParsedMessage = {
        method: 'notification/test',
        raw: 'notif'
      };

      // Add in mixed order
      queue.add(notification);
      queue.add(regularMessage);
      queue.add(initMessage);
      queue.add(toolMessage);

      // Act
      const messages = queue.flush();

      // Assert - Should be sorted by priority
      expect(messages).toHaveLength(4);
      expect(messages[0]).toBe(initMessage);    // Priority 0 (highest)
      expect(messages[1]).toBe(toolMessage);    // Priority 1
      expect(messages[2]).toBe(regularMessage); // Priority 2
      expect(messages[3]).toBe(notification);   // Priority 3 (lowest)
    });

    it('should clear queue after flush', () => {
      // Arrange
      queue.add({ raw: 'msg1' });
      queue.add({ raw: 'msg2' });

      // Act
      queue.flush();

      // Assert
      expect(queue.size()).toBe(0);
      expect(queue.flush()).toEqual([]);
    });

    it('should maintain order within same priority', () => {
      // Arrange - Add multiple tools/resource calls (same priority)
      const tool1: ParsedMessage = {
        method: 'tools/call',
        id: 1,
        raw: 'tool1'
      };
      const tool2: ParsedMessage = {
        method: 'tools/list',
        id: 2,
        raw: 'tool2'
      };
      const resource1: ParsedMessage = {
        method: 'resources/read',
        id: 3,
        raw: 'resource1'
      };

      queue.add(tool1);
      queue.add(tool2);
      queue.add(resource1);

      // Act
      const messages = queue.flush();

      // Assert - Should maintain FIFO within same priority
      expect(messages).toEqual([tool1, tool2, resource1]);
    });

    it('should handle empty queue', () => {
      // Act
      const messages = queue.flush();

      // Assert
      expect(messages).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should remove all messages without returning them', () => {
      // Arrange
      queue.add({ raw: 'msg1' });
      queue.add({ raw: 'msg2' });
      queue.add({ raw: 'msg3' });

      // Act
      queue.clear();

      // Assert
      expect(queue.size()).toBe(0);
      expect(queue.flush()).toEqual([]);
    });
  });

  describe('size', () => {
    it('should return 0 for empty queue', () => {
      expect(queue.size()).toBe(0);
    });

    it('should track size as messages are added', () => {
      // Act & Assert
      queue.add({ raw: 'msg1' });
      expect(queue.size()).toBe(1);

      queue.add({ raw: 'msg2' });
      expect(queue.size()).toBe(2);

      queue.add({ raw: 'msg3' });
      expect(queue.size()).toBe(3);
    });

    it('should update size after flush', () => {
      // Arrange
      queue.add({ raw: 'msg1' });
      queue.add({ raw: 'msg2' });

      // Act
      queue.flush();

      // Assert
      expect(queue.size()).toBe(0);
    });

    it('should update size after clear', () => {
      // Arrange
      queue.add({ raw: 'msg1' });
      queue.add({ raw: 'msg2' });

      // Act
      queue.clear();

      // Assert
      expect(queue.size()).toBe(0);
    });
  });

  describe('priority assignment', () => {
    it('should give highest priority to initialize', () => {
      // Arrange
      const messages: ParsedMessage[] = [
        { method: 'other', id: 1, raw: 'other' },
        { method: 'initialize', id: 2, raw: 'init' },
        { method: 'tools/call', id: 3, raw: 'tool' }
      ];

      messages.forEach(msg => queue.add(msg));

      // Act
      const flushed = queue.flush();

      // Assert
      expect(flushed[0].method).toBe('initialize');
    });

    it('should give high priority to tools and resources', () => {
      // Arrange
      const messages: ParsedMessage[] = [
        { method: 'notification/test', raw: 'notif' },
        { method: 'tools/call', id: 1, raw: 'tool' },
        { method: 'resources/read', id: 2, raw: 'resource' },
        { method: 'other', id: 3, raw: 'other' }
      ];

      messages.forEach(msg => queue.add(msg));

      // Act
      const flushed = queue.flush();

      // Assert
      expect(flushed[0].method).toBe('tools/call');
      expect(flushed[1].method).toBe('resources/read');
      expect(flushed[2].method).toBe('other');
      expect(flushed[3].method).toBe('notification/test');
    });

    it('should give lowest priority to notifications', () => {
      // Arrange
      const notification: ParsedMessage = {
        method: 'notification/test',
        raw: 'notif'
      };
      const request: ParsedMessage = {
        method: 'other',
        id: 1,
        raw: 'request'
      };

      queue.add(notification);
      queue.add(request);

      // Act
      const flushed = queue.flush();

      // Assert
      expect(flushed[0]).toBe(request);
      expect(flushed[1]).toBe(notification);
    });

    it('should handle messages without method', () => {
      // Arrange
      const noMethod: ParsedMessage = { raw: 'no-method' };
      const withMethod: ParsedMessage = {
        method: 'test',
        id: 1,
        raw: 'with-method'
      };

      queue.add(noMethod);
      queue.add(withMethod);

      // Act
      const flushed = queue.flush();

      // Assert - Request with ID has higher priority than no-method
      expect(flushed[0]).toBe(withMethod);
      expect(flushed[1]).toBe(noMethod);
    });

    it('should handle messages without id as notifications', () => {
      // Arrange
      const noId: ParsedMessage = {
        method: 'some-method',
        raw: 'no-id'
      };
      const withId: ParsedMessage = {
        method: 'other-method',
        id: 1,
        raw: 'with-id'
      };

      queue.add(noId);
      queue.add(withId);

      // Act
      const flushed = queue.flush();

      // Assert - Message with ID (request) has higher priority
      expect(flushed[0]).toBe(withId);
      expect(flushed[1]).toBe(noId);
    });
  });
});