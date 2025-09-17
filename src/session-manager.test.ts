import { describe, it, expect, beforeEach } from '@jest/globals';
import { SessionManager } from './session-manager.js';
import { JSONRPCMessage, MCPInitializeRequest } from './types.js';

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  describe('handleClientMessage', () => {
    it('should capture initialize request', () => {
      // Arrange
      const initRequest: MCPInitializeRequest = {
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          protocolVersion: '2024-11-05',
          clientInfo: {
            name: 'test-client',
            version: '1.0.0'
          }
        }
      };

      // Act
      const shouldForward = sessionManager.handleClientMessage(initRequest, JSON.stringify(initRequest));

      // Assert
      expect(shouldForward).toBe(true);
      expect(sessionManager.getInitializeRequest()).toBe(JSON.stringify(initRequest) + '\n');
    });

    it('should track pending requests with IDs', () => {
      // Arrange
      const request: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 42
      };

      // Act
      sessionManager.handleClientMessage(request, JSON.stringify(request));

      // Assert
      const timedOut = sessionManager.clearPendingRequests(0);
      expect(timedOut).toHaveLength(1);
      expect(timedOut[0].message.id).toBe(42);
    });

    it('should not forward messages before initialization', () => {
      // Arrange
      const request: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      };

      // Act
      const shouldForward = sessionManager.handleClientMessage(request, JSON.stringify(request));

      // Assert
      expect(shouldForward).toBe(false);
    });
  });

  describe('handleServerMessage', () => {
    it('should mark session as initialized on initialize response', () => {
      // Arrange
      const initRequest: MCPInitializeRequest = {
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: { protocolVersion: '2024-11-05' }
      };
      sessionManager.handleClientMessage(initRequest, JSON.stringify(initRequest));

      const initResponse: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'test-server', version: '1.0.0' }
        }
      };

      // Act
      sessionManager.handleServerMessage(initResponse);

      // Assert
      expect(sessionManager.isSessionInitialized()).toBe(true);
    });

    it('should capture tools list from server', () => {
      // Arrange
      const toolsResponse: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        result: {
          tools: [
            { name: 'tool1', description: 'Test tool' }
          ]
        }
      };

      // Act
      sessionManager.handleServerMessage(toolsResponse);

      // Assert
      // Tools list should be captured internally
    });

    it('should clear pending requests on response', () => {
      // Arrange
      const request: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        id: 123
      };
      sessionManager.handleClientMessage(request, JSON.stringify(request));

      const response: JSONRPCMessage = {
        jsonrpc: '2.0',
        id: 123,
        result: 'success'
      };

      // Act
      sessionManager.handleServerMessage(response);

      // Assert
      const timedOut = sessionManager.clearPendingRequests(0);
      expect(timedOut).toHaveLength(0);
    });
  });

  describe('message queueing', () => {
    it('should queue and retrieve messages', () => {
      // Arrange
      const message1: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test1',
        id: 1
      };
      const message2: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test2',
        id: 2
      };

      // Act
      sessionManager.queueMessage(message1, JSON.stringify(message1));
      sessionManager.queueMessage(message2, JSON.stringify(message2));
      const queued = sessionManager.getQueuedMessages();

      // Assert
      expect(queued).toHaveLength(2);
      expect(queued[0].message.method).toBe('test1');
      expect(queued[1].message.method).toBe('test2');
    });

    it('should clear queue after retrieval', () => {
      // Arrange
      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        id: 1
      };

      // Act
      sessionManager.queueMessage(message, JSON.stringify(message));
      sessionManager.getQueuedMessages();
      const secondGet = sessionManager.getQueuedMessages();

      // Assert
      expect(secondGet).toHaveLength(0);
    });
  });

  describe('createToolsChangedNotification', () => {
    it('should create valid tools changed notification', () => {
      // Arrange & Act
      const notification = sessionManager.createToolsChangedNotification();

      // Assert
      expect(notification.jsonrpc).toBe('2.0');
      expect(notification.method).toBe('notifications/tools/list_changed');
      expect(notification.params).toEqual({});
      expect(notification.id).toBeUndefined();
    });
  });

  describe('clearPendingRequests', () => {
    it('should clear requests older than timeout', () => {
      // Arrange
      const request: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        id: 1
      };
      sessionManager.handleClientMessage(request, JSON.stringify(request));

      // Act
      const timedOut = sessionManager.clearPendingRequests(0);

      // Assert
      expect(timedOut).toHaveLength(1);
      expect(timedOut[0].message.id).toBe(1);
    });

    it('should not clear recent requests', () => {
      // Arrange
      const request: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        id: 1
      };
      sessionManager.handleClientMessage(request, JSON.stringify(request));

      // Act
      const timedOut = sessionManager.clearPendingRequests(60000);

      // Assert
      expect(timedOut).toHaveLength(0);
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      // Arrange
      const initRequest: MCPInitializeRequest = {
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: { protocolVersion: '2024-11-05' }
      };
      sessionManager.handleClientMessage(initRequest, JSON.stringify(initRequest));
      sessionManager.queueMessage(initRequest, JSON.stringify(initRequest));

      // Act
      sessionManager.reset();

      // Assert
      expect(sessionManager.isSessionInitialized()).toBe(false);
      expect(sessionManager.getQueuedMessages()).toHaveLength(0);
      expect(sessionManager.clearPendingRequests(0)).toHaveLength(0);
    });
  });
});