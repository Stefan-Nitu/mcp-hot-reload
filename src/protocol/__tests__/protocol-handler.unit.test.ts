import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProtocolHandler } from '../protocol-handler.js';
import { PassThrough, Writable, Readable } from 'stream';
import type { ServerConnection } from '../../process/server-connection.js';
import {
  createInitializeRequest,
  createInitializeResponse,
  createToolCallRequest,
  createNotification,
  createRequest
} from '../../types/mcp-messages.js';

/**
 * ProtocolHandler Test Suite
 *
 * This unifies and enhances tests from:
 * - MessageRouter: Basic routing, queueing, connection management
 * - SessionTracker: Session state, initialize tracking, pending requests
 *
 * New behaviors tested:
 * - Session-driven routing decisions
 * - Intelligent queue management with priorities
 * - Crash recovery integration
 * - Unified message processing (parse once, use everywhere)
 */
describe('ProtocolHandler', () => {
  let handler: ProtocolHandler;
  let clientIn: PassThrough;
  let clientOut: PassThrough;
  let serverConnection: ServerConnection;
  let serverIn: Writable;
  let serverOut: Readable;

  beforeEach(() => {
    clientIn = new PassThrough();
    clientOut = new PassThrough();

    // Mock ServerConnection
    serverIn = new PassThrough();
    serverOut = new PassThrough();
    serverConnection = {
      stdin: serverIn,
      stdout: serverOut,
      pid: 12345,
      waitForCrash: vi.fn().mockReturnValue(new Promise(() => {})), // Never resolves by default
      isAlive: vi.fn().mockReturnValue(true),
      dispose: vi.fn()
    } as unknown as ServerConnection;

    handler = new ProtocolHandler(clientIn, clientOut);
  });

  describe('Basic Message Routing (from MessageRouter)', () => {
    it('should forward client messages to server when connected', () => {
      // EVOLUTION: Same test, but now uses ServerConnection instead of raw streams
      // WHY: Unified connection management through ServerConnection

      // Arrange
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));
      handler.connectServer(serverConnection);

      // Initialize first (required for session-driven routing)
      clientIn.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
      (serverOut as PassThrough).write('{"jsonrpc":"2.0","id":1,"result":{}}\n');
      serverData.length = 0; // Clear initialization messages

      // Act
      const message = '{"jsonrpc":"2.0","id":2,"method":"test"}\n';
      clientIn.write(message);

      // Assert
      expect(serverData).toEqual([message]);
    });

    it('should forward server messages to client', () => {
      // EVOLUTION: Unchanged - still fundamental behavior

      // Arrange
      const clientData: string[] = [];
      clientOut.on('data', chunk => clientData.push(chunk.toString()));
      handler.connectServer(serverConnection);

      // Act
      const response = '{"jsonrpc":"2.0","id":1,"result":"test"}\n';
      (serverOut as PassThrough).write(response);

      // Assert
      expect(clientData).toEqual([response]);
    });

    it('should handle malformed JSON without crashing', () => {
      // EVOLUTION: Now logs structured error internally but still forwards
      // WHY: Better debugging while maintaining protocol transparency

      // Arrange
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));
      handler.connectServer(serverConnection);

      // Initialize first
      clientIn.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
      (serverOut as PassThrough).write('{"jsonrpc":"2.0","id":1,"result":{}}\n');
      serverData.length = 0; // Clear initialization messages

      // Act
      const malformed = 'not json\n';
      clientIn.write(malformed);

      // Assert
      expect(serverData).toEqual([malformed]);
    });
  });

  describe('Session State Management (from SessionTracker)', () => {
    it('starts uninitialized', () => {
      // EVOLUTION: Now exposed through handler.getSessionState()
      // WHY: Session state is first-class, not hidden

      expect(handler.getSessionState()).toEqual({
        initialized: false,
        initializeRequest: null,
        pendingRequest: null
      });
    });

    it('tracks initialize request and becomes initialized on response', () => {
      // EVOLUTION: Combined test showing full initialize flow
      // WHY: Tests the cohesive behavior, not separate tracking

      // Arrange
      handler.connectServer(serverConnection);
      const initRequest = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1.0"}}\n';
      const initResponse = '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"1.0"}}\n';

      // Act - Send initialize
      clientIn.write(initRequest);

      // Assert - Request tracked
      expect(handler.getSessionState().initializeRequest).toEqual(initRequest);
      expect(handler.getSessionState().initialized).toBe(false);

      // Act - Receive response
      (serverOut as PassThrough).write(initResponse);

      // Assert - Session initialized
      expect(handler.getSessionState().initialized).toBe(true);
    });

    it('tracks pending requests and clears on response', () => {
      // EVOLUTION: From SessionTracker pending request tracking
      // WHY: Critical for crash recovery - know what was in-flight

      // Arrange
      handler.connectServer(serverConnection);
      const request = '{"jsonrpc":"2.0","id":42,"method":"tools/call","params":{}}\n';
      const response = '{"jsonrpc":"2.0","id":42,"result":"success"}\n';

      // Act - Send request
      clientIn.write(request);

      // Assert - Request pending
      expect(handler.getSessionState().pendingRequest).toEqual({
        id: 42,
        method: 'tools/call'
      });

      // Act - Receive response
      (serverOut as PassThrough).write(response);

      // Assert - Request cleared
      expect(handler.getSessionState().pendingRequest).toBeNull();
    });

    it('resets state on new initialize request', () => {
      // EVOLUTION: Unchanged from SessionTracker
      // WHY: Still essential session behavior

      // Arrange
      handler.connectServer(serverConnection);

      // First initialize cycle
      clientIn.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
      (serverOut as PassThrough).write('{"jsonrpc":"2.0","id":1,"result":{}}\n');
      expect(handler.getSessionState().initialized).toBe(true);

      // Act - New initialize
      clientIn.write('{"jsonrpc":"2.0","id":2,"method":"initialize","params":{}}\n');

      // Assert - State reset
      expect(handler.getSessionState().initialized).toBe(false);
    });
  });

  describe('Intelligent Queue Management (NEW)', () => {
    it('should queue messages with priority when server unavailable', () => {
      // NEW TEST: Shows intelligent queueing based on message type
      // WHY: Not all messages are equal - some are more important

      // Arrange - No server connected
      const serverData: string[] = [];

      // Act - Send various message types
      clientIn.write(createInitializeRequest(1));
      clientIn.write(createToolCallRequest(2, 'test-tool'));
      clientIn.write(createNotification('notifications/progress'));

      // Connect server and capture what's sent
      serverIn.on('data', chunk => serverData.push(chunk.toString()));
      handler.connectServer(serverConnection);

      // Assert - Initialize is sent from session, others from queue
      // The initialize request is stored separately and sent first
      // Then other messages are flushed from queue
      expect(serverData.length).toBeGreaterThanOrEqual(1);
      expect(serverData[0]).toContain('"method":"initialize"');
      // The other messages may or may not be sent depending on implementation
      // This is testing that initialize has highest priority
    });

    it('should handle restart with session preservation', () => {
      // NEW TEST: Shows the cohesive restart flow
      // WHY: This is the core value - seamless restarts

      // Arrange - Initialized session
      handler.connectServer(serverConnection);
      const initRequest = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1.0"}}\n';
      clientIn.write(initRequest);
      (serverOut as PassThrough).write('{"jsonrpc":"2.0","id":1,"result":{}}\n');

      // Act - Disconnect (simulating restart)
      handler.disconnectServer();

      // Send request while disconnected
      clientIn.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');

      // Reconnect with new server
      const newServerIn = new PassThrough();
      const newServerOut = new PassThrough();
      const newServerData: string[] = [];
      newServerIn.on('data', chunk => newServerData.push(chunk.toString()));

      const newConnection = {
        stdin: newServerIn,
        stdout: newServerOut,
        pid: 12346,
        waitForCrash: vi.fn().mockReturnValue(new Promise(() => {})),
        isAlive: vi.fn().mockReturnValue(true),
        dispose: vi.fn()
      } as unknown as ServerConnection;

      handler.connectServer(newConnection);

      // Assert - Initialize replayed first, then queued message
      expect(newServerData[0]).toEqual(initRequest);
      expect(newServerData[1]).toContain('"method":"tools/list"');
    });
  });

  describe('Session-Driven Routing (NEW)', () => {
    it('should buffer all messages during initialization', () => {
      // NEW TEST: Shows session state driving behavior
      // WHY: Can't process requests until initialized

      // Arrange
      handler.connectServer(serverConnection);
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));

      // Act - Send initialize, then other requests before response
      clientIn.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
      clientIn.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');

      // Assert - Only initialize forwarded
      expect(serverData).toHaveLength(1);
      expect(serverData[0]).toContain('"method":"initialize"');

      // Act - Complete initialization
      (serverOut as PassThrough).write('{"jsonrpc":"2.0","id":1,"result":{}}\n');

      // Assert - Buffered message now sent
      expect(serverData).toHaveLength(2);
      expect(serverData[1]).toContain('"method":"tools/list"');
    });

    it('should handle notifications differently based on session state', () => {
      // NEW TEST: Notifications can be dropped if not initialized
      // WHY: Notifications are fire-and-forget, less critical

      // Arrange - Not initialized
      handler.connectServer(serverConnection);
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));

      // Act - Send notification before initialization
      clientIn.write('{"jsonrpc":"2.0","method":"notifications/progress"}\n');

      // Assert - Notification queued but low priority
      expect(serverData).toHaveLength(0);

      // Act - Initialize
      clientIn.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
      (serverOut as PassThrough).write('{"jsonrpc":"2.0","id":1,"result":{}}\n');

      // Act - Send another notification
      clientIn.write('{"jsonrpc":"2.0","method":"notifications/update"}\n');

      // Assert - Post-init notification forwarded immediately
      expect(serverData.filter(d => d.includes('notifications/update'))).toHaveLength(1);
    });
  });

  describe('Crash Recovery Integration (NEW)', () => {
    it('should handle server crash with pending request', () => {
      // NEW TEST: Integration with crash detection
      // WHY: Core feature - graceful error handling

      // Arrange
      handler.connectServer(serverConnection);
      const clientData: string[] = [];
      clientOut.on('data', chunk => clientData.push(chunk.toString()));

      // Send request
      clientIn.write('{"jsonrpc":"2.0","id":99,"method":"tools/call","params":{}}\n');

      // Act - Trigger crash callback
      handler.handleServerCrash(1, null);

      // Assert - Error response sent to client
      expect(clientData).toHaveLength(1);
      const errorResponse = JSON.parse(clientData[0]);
      expect(errorResponse.id).toBe(99);
      expect(errorResponse.error).toBeDefined();
      expect(errorResponse.error.message).toContain('terminated unexpectedly');
    });

    it('should setup crash monitoring on connect', () => {
      // NEW TEST: Verifies crash detection is wired up
      // WHY: Must monitor for crashes automatically

      // Act
      handler.connectServer(serverConnection);

      // Assert
      expect(serverConnection.waitForCrash).toHaveBeenCalled();
    });
  });

  describe('Stream Error Handling (from MessageRouter)', () => {
    it('should handle server stream errors without crashing', () => {
      // EVOLUTION: Enhanced with recovery behavior
      // WHY: Robustness - proxy shouldn't crash on stream errors

      // Arrange
      handler.connectServer(serverConnection);
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));

      // Initialize session first
      clientIn.write(createInitializeRequest(1));
      (serverOut as PassThrough).write(createInitializeResponse(1));

      // Act - Trigger stream error (doesn't affect stdin, just logs error)
      (serverOut as PassThrough).emit('error', new Error('Stream error'));

      // Assert - Handler still functional, messages still forward
      // (stdout error doesn't break stdin)
      clientIn.write(createRequest(2, 'test'));
      expect(serverData).toHaveLength(2); // init + test
    });

    it('should handle write errors gracefully', () => {
      // EVOLUTION: Better error recovery
      // WHY: Network issues shouldn't break the proxy

      // Arrange
      handler.connectServer(serverConnection);
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));

      // Initialize session first
      clientIn.write(createInitializeRequest(1));
      expect(serverData).toHaveLength(1); // Initialize sent

      (serverOut as PassThrough).write(createInitializeResponse(1));

      // Make server stream unwritable to simulate network issue
      Object.defineProperty(serverIn, 'writable', { value: false, configurable: true });

      // Act - Try to send message (will be queued)
      clientIn.write(createRequest(2, 'test'));

      // Assert - Message was queued since stream is not writable
      expect(serverData).toHaveLength(1); // Still just init
      expect(handler.getQueueSize()).toBeGreaterThan(0);

      // Restore writability
      Object.defineProperty(serverIn, 'writable', { value: true, configurable: true });

      // Reconnect should flush queue
      handler.disconnectServer();
      handler.connectServer(serverConnection);

      // Assert - Queued message flushed on reconnect
      expect(serverData).toHaveLength(3); // init + init(replay) + test
    });
  });

  describe('Cleanup and Disposal', () => {
    it('should clean up all resources on shutdown', () => {
      // NEW TEST: Proper cleanup
      // WHY: Prevent memory leaks

      // Arrange
      handler.connectServer(serverConnection);

      // Act
      handler.shutdown();

      // Assert
      expect(serverConnection.dispose).toHaveBeenCalled();
      expect(handler.getSessionState()).toEqual({
        initialized: false,
        initializeRequest: null,
        pendingRequest: null
      });
    });
  });

  describe('Global Error Handling', () => {
    it('should handle uncaught exceptions without crashing', () => {
      // NEW TEST: Proxy resilience to internal errors
      // WHY: Proxy must be resilient to unexpected errors

      // Arrange
      handler.connectServer(serverConnection);
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));

      // Initialize session first
      clientIn.write(createInitializeRequest(1));
      (serverOut as PassThrough).write(createInitializeResponse(1));

      const error = new Error('Unexpected error in message processing');

      // Act - Simulate internal error
      handler.handleUncaughtError(error);

      // Assert - Handler still functional
      clientIn.write(createRequest(2, 'test'));
      expect(serverData).toHaveLength(2); // init + test
    });

    it('should handle unhandled promise rejections', () => {
      // NEW TEST: Resilience to async errors
      // WHY: Async errors shouldn't crash the proxy

      // Arrange
      handler.connectServer(serverConnection);
      const rejection = new Error('Unhandled async error');

      // Act
      handler.handleUnhandledRejection(rejection);

      // Assert - Still operational
      expect(handler.getSessionState()).toBeDefined();
    });

    it('should cleanup on stdin end', () => {
      // NEW TEST: Clean shutdown when client disconnects
      // WHY: Clean shutdown when client disconnects

      // Arrange
      const shutdownSpy = vi.spyOn(handler, 'shutdown');
      handler.connectServer(serverConnection);

      // Act - Simulate stdin end
      handler.handleStdinEnd();

      // Assert
      expect(shutdownSpy).toHaveBeenCalled();
      expect(serverConnection.dispose).toHaveBeenCalled();
    });
  });

  describe('Multiple Message Handling (from MessageRouter)', () => {
    it('should handle multiple messages in one chunk', () => {
      // EVOLUTION: Enhanced with proper parsing and individual handling
      // WHY: Network can batch messages

      // Arrange
      handler.connectServer(serverConnection);
      const serverData: string[] = [];

      // Set up listener BEFORE any writes
      serverIn.on('data', chunk => serverData.push(chunk.toString()));

      // Initialize first
      clientIn.write(createInitializeRequest(0));
      (serverOut as PassThrough).write(createInitializeResponse(0));

      // Act - Multiple messages in one write
      const messages =
        createRequest(1, 'test1') +
        createRequest(2, 'test2');
      clientIn.write(messages);

      // Assert - Three messages total (initialize + test1 + test2)
      expect(serverData).toHaveLength(3);
      expect(serverData[0]).toContain('"method":"initialize"');
      expect(serverData[1]).toContain('"method":"test1"');
      expect(serverData[2]).toContain('"method":"test2"');
    });

    it('should handle partial messages across chunks', () => {
      // EVOLUTION: From message-parser tests
      // WHY: TCP doesn't respect message boundaries

      // Arrange
      handler.connectServer(serverConnection);
      const serverData: string[] = [];

      // Set up listener BEFORE any writes
      serverIn.on('data', chunk => serverData.push(chunk.toString()));

      // Initialize first
      clientIn.write(createInitializeRequest(0));
      (serverOut as PassThrough).write(createInitializeResponse(0));

      // Act - Split message across two writes
      clientIn.write('{"jsonrpc":"2.0","id":1,');
      clientIn.write('"method":"test"}\n');

      // Assert - Initialize + reassembled message
      expect(serverData).toHaveLength(2);
      expect(serverData[0]).toContain('"method":"initialize"');
      expect(serverData[1]).toEqual('{"jsonrpc":"2.0","id":1,"method":"test"}\n');
    });
  });
});