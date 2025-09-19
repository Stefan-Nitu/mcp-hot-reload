import { describe, it, expect, beforeEach } from '@jest/globals';
import { SessionTracker } from './session-tracker.js';

describe('SessionTracker', () => {
  let tracker: SessionTracker;

  beforeEach(() => {
    tracker = new SessionTracker();
  });

  it('starts uninitialized', () => {
    expect(tracker.isInitialized()).toBe(false);
  });

  it('tracks initialize request', () => {
    // Arrange
    const initMessage = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1.0' }
    };
    const rawMessage = JSON.stringify(initMessage) + '\n';

    // Act
    tracker.trackInitializeRequest(initMessage, rawMessage);

    // Assert
    expect(tracker.getInitializeRequest()).toEqual(rawMessage);
    expect(tracker.isInitialized()).toBe(false);
  });

  it('ignores non-initialize messages', () => {
    // Arrange
    const otherMessage = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'tools/list',
      params: {}
    };
    const rawMessage = JSON.stringify(otherMessage) + '\n';

    // Act
    tracker.trackInitializeRequest(otherMessage, rawMessage);

    // Assert
    expect(tracker.getInitializeRequest()).toBeNull();
  });

  it('becomes initialized when matching response is tracked', () => {
    // Arrange
    const initMessage = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1.0' }
    };
    const rawMessage = JSON.stringify(initMessage) + '\n';

    const initResponse = {
      jsonrpc: '2.0' as const,
      id: 1,
      result: { protocolVersion: '1.0' }
    };

    // Act
    tracker.trackInitializeRequest(initMessage, rawMessage);
    tracker.trackInitializeResponse(initResponse);

    // Assert
    expect(tracker.isInitialized()).toBe(true);
  });

  it('ignores response with different ID', () => {
    // Arrange
    const initMessage = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1.0' }
    };
    const rawMessage = JSON.stringify(initMessage) + '\n';

    const wrongResponse = {
      jsonrpc: '2.0' as const,
      id: 99,
      result: { protocolVersion: '1.0' }
    };

    // Act
    tracker.trackInitializeRequest(initMessage, rawMessage);
    tracker.trackInitializeResponse(wrongResponse);

    // Assert
    expect(tracker.isInitialized()).toBe(false);
  });

  it('ignores error responses', () => {
    // Arrange
    const initMessage = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1.0' }
    };
    const rawMessage = JSON.stringify(initMessage) + '\n';

    const errorResponse = {
      jsonrpc: '2.0' as const,
      id: 1,
      error: { code: -32601, message: 'Method not found' }
    };

    // Act
    tracker.trackInitializeRequest(initMessage, rawMessage);
    tracker.trackInitializeResponse(errorResponse);

    // Assert
    expect(tracker.isInitialized()).toBe(false);
  });

  it('resets state when new initialize request is tracked', () => {
    // Arrange
    const firstMessage = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1.0' }
    };
    const firstRaw = JSON.stringify(firstMessage) + '\n';

    const firstResponse = {
      jsonrpc: '2.0' as const,
      id: 1,
      result: { protocolVersion: '1.0' }
    };

    tracker.trackInitializeRequest(firstMessage, firstRaw);
    tracker.trackInitializeResponse(firstResponse);
    expect(tracker.isInitialized()).toBe(true);

    // Act - new initialize request
    const secondMessage = {
      jsonrpc: '2.0' as const,
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '2.0' }
    };
    const secondRaw = JSON.stringify(secondMessage) + '\n';
    tracker.trackInitializeRequest(secondMessage, secondRaw);

    // Assert - reset to uninitialized
    expect(tracker.isInitialized()).toBe(false);
    expect(tracker.getInitializeRequest()).toEqual(secondRaw);
  });

  it('can be manually reset', () => {
    // Arrange
    const initMessage = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1.0' }
    };
    const rawMessage = JSON.stringify(initMessage) + '\n';

    const initResponse = {
      jsonrpc: '2.0' as const,
      id: 1,
      result: { protocolVersion: '1.0' }
    };

    tracker.trackInitializeRequest(initMessage, rawMessage);
    tracker.trackInitializeResponse(initResponse);

    // Act
    tracker.reset();

    // Assert
    expect(tracker.isInitialized()).toBe(false);
    expect(tracker.getInitializeRequest()).toBeNull();
  });

  it('returns null when no request is set', () => {
    expect(tracker.getInitializeRequest()).toBeNull();
  });

  it('handles initialize messages without ID', () => {
    // Arrange
    const messageNoId = {
      jsonrpc: '2.0' as const,
      method: 'initialize',
      params: { protocolVersion: '1.0' }
    };
    const rawMessage = JSON.stringify(messageNoId) + '\n';

    // Act
    tracker.trackInitializeRequest(messageNoId, rawMessage);

    // Assert - should not track without ID
    expect(tracker.getInitializeRequest()).toBeNull();
  });
});