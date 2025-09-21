import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionTracker } from '../tracker.js';
import { MessageParser } from '../../messaging/parser.js';

describe('SessionTracker', () => {
  let tracker: SessionTracker;
  let mockMessageParser: MessageParser;

  beforeEach(() => {
    mockMessageParser = new MessageParser();
    tracker = new SessionTracker(mockMessageParser);
  });

  it('starts uninitialized', () => {
    expect(tracker.isInitialized()).toBe(false);
  });

  it('tracks initialize request from client data', () => {
    // Arrange
    const initMessage = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1.0' }
    };
    const rawMessage = JSON.stringify(initMessage) + '\n';

    // Act
    const result = tracker.processClientData(rawMessage);

    // Assert
    expect(tracker.getInitializeRequest()).toEqual(rawMessage);
    expect(tracker.isInitialized()).toBe(false);
    expect(result).toEqual(rawMessage); // Returns unchanged for forwarding
  });

  it('ignores non-initialize messages from client', () => {
    // Arrange
    const otherMessage = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'tools/list',
      params: {}
    };
    const rawMessage = JSON.stringify(otherMessage) + '\n';

    // Act
    const result = tracker.processClientData(rawMessage);

    // Assert
    expect(tracker.getInitializeRequest()).toBeNull();
    expect(result).toEqual(rawMessage); // Still forwards the data
  });

  it('becomes initialized when matching response from server is tracked', () => {
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
    const rawResponse = JSON.stringify(initResponse) + '\n';

    // Act
    tracker.processClientData(rawMessage);
    const result = tracker.processServerData(rawResponse);

    // Assert
    expect(tracker.isInitialized()).toBe(true);
    expect(result).toEqual(rawResponse); // Returns unchanged for forwarding
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
    const rawWrongResponse = JSON.stringify(wrongResponse) + '\n';

    // Act
    tracker.processClientData(rawMessage);
    tracker.processServerData(rawWrongResponse);

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
    const rawErrorResponse = JSON.stringify(errorResponse) + '\n';

    // Act
    tracker.processClientData(rawMessage);
    tracker.processServerData(rawErrorResponse);

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
    const firstResponseRaw = JSON.stringify(firstResponse) + '\n';

    tracker.processClientData(firstRaw);
    tracker.processServerData(firstResponseRaw);
    expect(tracker.isInitialized()).toBe(true);

    // Act - new initialize request
    const secondMessage = {
      jsonrpc: '2.0' as const,
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '2.0' }
    };
    const secondRaw = JSON.stringify(secondMessage) + '\n';
    tracker.processClientData(secondRaw);

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
    const rawResponse = JSON.stringify(initResponse) + '\n';

    tracker.processClientData(rawMessage);
    tracker.processServerData(rawResponse);

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
    tracker.processClientData(rawMessage);

    // Assert - should not track without ID
    expect(tracker.getInitializeRequest()).toBeNull();
  });

  it('handles multiple messages in one data chunk', () => {
    // Arrange
    const initMessage = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1.0' }
    };
    const toolsMessage = {
      jsonrpc: '2.0' as const,
      id: 2,
      method: 'tools/list',
      params: {}
    };
    const combinedData = JSON.stringify(initMessage) + '\n' + JSON.stringify(toolsMessage) + '\n';

    // Act
    const result = tracker.processClientData(combinedData);

    // Assert
    expect(tracker.getInitializeRequest()).toEqual(JSON.stringify(initMessage) + '\n');
    expect(result).toEqual(combinedData); // Returns all data unchanged
  });
});