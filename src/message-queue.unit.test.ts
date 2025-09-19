import { describe, it, expect, beforeEach } from '@jest/globals';
import { MessageQueue } from './message-queue.js';

describe('MessageQueue', () => {
  let queue: MessageQueue;

  beforeEach(() => {
    queue = new MessageQueue();
  });

  it('adds messages to queue', () => {
    // Arrange - queue starts empty via beforeEach

    // Act
    queue.add('message1');
    queue.add('message2');
    queue.add('message3');

    // Assert
    expect(queue.size()).toBe(3);
  });

  it('returns all messages when flushed', () => {
    // Arrange
    queue.add('message1');
    queue.add('message2');

    // Act
    const messages = queue.flush();

    // Assert
    expect(messages).toEqual(['message1', 'message2']);
  });

  it('clears queue after flush', () => {
    // Arrange
    queue.add('message1');
    queue.add('message2');

    // Act
    queue.flush();

    // Assert
    expect(queue.size()).toBe(0);
    expect(queue.flush()).toEqual([]);
  });

  it('can clear without flushing', () => {
    // Arrange
    queue.add('message1');
    queue.add('message2');

    // Act
    queue.clear();

    // Assert
    expect(queue.size()).toBe(0);
    expect(queue.flush()).toEqual([]);
  });

  it('reports correct size as messages are added and removed', () => {
    // Arrange - queue starts empty
    expect(queue.size()).toBe(0);

    // Act & Assert - test size changes with operations
    queue.add('message1');
    expect(queue.size()).toBe(1);

    queue.add('message2');
    expect(queue.size()).toBe(2);

    queue.flush();
    expect(queue.size()).toBe(0);
  });

  it('maintains order of messages', () => {
    // Arrange
    queue.add('first');
    queue.add('second');
    queue.add('third');

    // Act
    const messages = queue.flush();

    // Assert
    expect(messages).toEqual(['first', 'second', 'third']);
  });
});