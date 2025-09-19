import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MessageRouter } from './message-router.js';
import { PassThrough, Writable } from 'stream';
import type { MessageQueue } from './message-queue.js';
import type { SessionTracker } from './session-tracker.js';

describe('MessageRouter', () => {
  let router: MessageRouter;
  let clientIn: PassThrough;
  let clientOut: PassThrough;
  let serverIn: PassThrough;
  let serverOut: PassThrough;
  let messageQueue: jest.Mocked<MessageQueue>;
  let sessionTracker: jest.Mocked<SessionTracker>;

  beforeEach(() => {
    clientIn = new PassThrough();
    clientOut = new PassThrough();
    serverIn = new PassThrough();
    serverOut = new PassThrough();

    // Create mock with only the methods we use in tests
    // TypeScript requires type assertion due to private properties
    messageQueue = {
      add: jest.fn<MessageQueue['add']>(),
      flush: jest.fn<MessageQueue['flush']>().mockReturnValue([]),
      clear: jest.fn<MessageQueue['clear']>(),
      size: jest.fn<MessageQueue['size']>().mockReturnValue(0)
    } as unknown as jest.Mocked<MessageQueue>;

    // Create mock with only the methods we use in tests
    // TypeScript requires type assertion due to private properties
    sessionTracker = {
      trackInitializeRequest: jest.fn<SessionTracker['trackInitializeRequest']>(),
      trackInitializeResponse: jest.fn<SessionTracker['trackInitializeResponse']>(),
      getInitializeRequest: jest.fn<SessionTracker['getInitializeRequest']>(),
      isInitialized: jest.fn<SessionTracker['isInitialized']>().mockReturnValue(false),
      reset: jest.fn<SessionTracker['reset']>()
    } as unknown as jest.Mocked<SessionTracker>;

    router = new MessageRouter(
      clientIn,
      clientOut,
      messageQueue,
      sessionTracker
    );
  });

  describe('message routing', () => {
    it('should forward client messages to server when connected', () => {
      // Arrange
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));
      router.connectServer(serverIn, serverOut);

      // Act
      const message = '{"jsonrpc":"2.0","id":1,"method":"test"}\n';
      clientIn.write(message);

      // Assert
      expect(serverData).toEqual([message]);
    });

    it('should queue messages when server is unavailable', () => {
      // Arrange - Test multiple unavailable conditions
      const message = '{"jsonrpc":"2.0","id":1,"method":"test"}\n';

      // Act & Assert - Not connected
      clientIn.write(message);
      expect(messageQueue.add).toHaveBeenCalledWith(message);
      messageQueue.add.mockClear();

      // Act & Assert - After disconnection
      router.connectServer(serverIn, serverOut);
      router.disconnectServer();
      clientIn.write(message);
      expect(messageQueue.add).toHaveBeenCalledWith(message);
    });

    it('should forward server messages to client', () => {
      // Arrange
      const clientData: string[] = [];
      clientOut.on('data', chunk => clientData.push(chunk.toString()));
      router.connectServer(serverIn, serverOut);

      // Act
      const response = '{"jsonrpc":"2.0","id":1,"result":"test"}\n';
      serverOut.write(response);

      // Assert
      expect(clientData).toEqual([response]);
    });

    it('should track initialize requests', () => {
      // Arrange
      router.connectServer(serverIn, serverOut);
      const initRequest = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n';

      // Act
      clientIn.write(initRequest);

      // Assert
      expect(sessionTracker.trackInitializeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'initialize' }),
        initRequest
      );
    });

    it('should track initialize responses', () => {
      // Arrange
      router.connectServer(serverIn, serverOut);
      const initResponse = '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"1.0"}}\n';

      // Act
      serverOut.write(initResponse);

      // Assert
      expect(sessionTracker.trackInitializeResponse).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, result: expect.any(Object) })
      );
    });

    it('should flush queued messages when server connects', () => {
      // Arrange
      const queuedMessages = ['{"jsonrpc":"2.0","id":1,"method":"test1"}\n'];
      messageQueue.flush.mockReturnValue(queuedMessages);
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));

      // Act
      router.connectServer(serverIn, serverOut);

      // Assert
      expect(messageQueue.flush).toHaveBeenCalled();
      expect(serverData).toEqual(queuedMessages);
    });

    it('should disconnect server and stop forwarding', () => {
      // Arrange
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));
      router.connectServer(serverIn, serverOut);
      router.disconnectServer();

      // Act
      const message = '{"jsonrpc":"2.0","id":2,"method":"test"}\n';
      clientIn.write(message);

      // Assert - message should be queued, not forwarded
      expect(serverData).toEqual([]);
      expect(messageQueue.add).toHaveBeenCalledWith(message);
    });

    it('should skip malformed JSON messages without crashing', () => {
      // Arrange
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));
      router.connectServer(serverIn, serverOut);

      // Act
      const malformed = 'not json\n';
      clientIn.write(malformed);

      // Assert - should still forward raw data
      expect(serverData).toEqual([malformed]);
    });

    it('should handle multiple messages in one chunk', () => {
      // Arrange
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));
      router.connectServer(serverIn, serverOut);

      // Act
      const messages = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"initialize","params":{}}\n';
      clientIn.write(messages);

      // Assert
      expect(serverData).toEqual([messages]);
      expect(sessionTracker.trackInitializeRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('no duplicate forwarding', () => {
    it('should forward server responses to client exactly once', () => {
      // Arrange
      const clientData: string[] = [];
      let clientWriteCount = 0;
      clientOut.on('data', chunk => {
        clientWriteCount++;
        clientData.push(chunk.toString());
      });
      router.connectServer(serverIn, serverOut);

      // Act - server sends a single response
      const response = '{"jsonrpc":"2.0","id":1,"result":{"test":true}}\n';
      serverOut.write(response);

      // Assert - client receives exactly one response
      expect(clientWriteCount).toBe(1);
      expect(clientData).toEqual([response]);
    });

    it('should forward client messages to server exactly once', () => {
      // Arrange
      const serverData: string[] = [];
      let serverWriteCount = 0;
      serverIn.on('data', chunk => {
        serverWriteCount++;
        serverData.push(chunk.toString());
      });
      router.connectServer(serverIn, serverOut);

      // Act - client sends a single request
      const request = '{"jsonrpc":"2.0","id":1,"method":"test","params":{}}\n';
      clientIn.write(request);

      // Assert - server receives exactly one request
      expect(serverWriteCount).toBe(1);
      expect(serverData).toEqual([request]);
    });

    it('should not create multiple listeners on reconnect', () => {
      // Arrange
      const clientData: string[] = [];
      clientOut.on('data', chunk => clientData.push(chunk.toString()));

      // Act - connect, disconnect, reconnect
      router.connectServer(serverIn, serverOut);
      router.disconnectServer();
      router.connectServer(serverIn, serverOut);

      // Send a response
      const response = '{"jsonrpc":"2.0","id":1,"result":{}}\n';
      serverOut.write(response);

      // Assert - should only receive one response despite reconnection
      expect(clientData).toEqual([response]);
    });
  });

  describe('cleanup', () => {
    it('should stop forwarding on stop()', () => {
      // Arrange
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));
      router.connectServer(serverIn, serverOut);

      // Act
      router.stop();
      clientIn.write('{"jsonrpc":"2.0","id":1,"method":"test"}\n');

      // Assert
      expect(serverData).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('should queue messages when serverIn.write() throws exception', () => {
      // Arrange
      const mockServerIn = new PassThrough();
      const mockWrite = jest.fn<(chunk: any) => boolean>().mockImplementation(() => {
        throw new Error('Write failed');
      });
      // TypeScript limitation: overloaded signatures require type assertion
      mockServerIn.write = mockWrite as typeof mockServerIn.write;
      router.connectServer(mockServerIn, serverOut);

      const message = '{"jsonrpc":"2.0","id":1,"method":"test"}\n';

      // Act
      clientIn.write(message);

      // Assert
      expect(mockWrite).toHaveBeenCalledWith(message);
      expect(messageQueue.add).toHaveBeenCalledWith(message);
    });

    it('should continue routing when clientOut.write() throws exceptions', () => {
      // Arrange
      const mockClientOut = new PassThrough();
      const mockWrite = jest.fn<any>(() => {
        throw new Error('Client write failed');
      });
      // TypeScript limitation: overloaded signatures require type assertion
      mockClientOut.write = mockWrite as typeof mockClientOut.write;

      const routerWithFailingClient = new MessageRouter(
        clientIn,
        mockClientOut,
        messageQueue as MessageQueue,
        sessionTracker as SessionTracker
      );
      routerWithFailingClient.connectServer(serverIn, serverOut);

      const response = '{"jsonrpc":"2.0","id":1,"result":"test"}\n';

      // Act & Assert - should not throw
      expect(() => {
        serverOut.write(response);
      }).not.toThrow();

      expect(mockWrite).toHaveBeenCalledWith(Buffer.from(response));
    });

    it('should re-queue messages when flush fails during server connection', () => {
      // Arrange
      const queuedMessages = ['{"jsonrpc":"2.0","id":1,"method":"test1"}\n'];
      messageQueue.flush.mockReturnValue(queuedMessages);

      const mockServerIn = new PassThrough();
      const mockWrite = jest.fn<any>(() => {
        throw new Error('Flush write failed');
      });
      // TypeScript limitation: overloaded signatures require type assertion
      mockServerIn.write = mockWrite as typeof mockServerIn.write;

      // Act
      router.connectServer(mockServerIn, serverOut);

      // Assert
      expect(messageQueue.flush).toHaveBeenCalled();
      expect(mockWrite).toHaveBeenCalledWith(queuedMessages[0]);
      expect(messageQueue.add).toHaveBeenCalledWith(queuedMessages[0]);
    });
  });

  describe('stream state validation', () => {
    it('should queue messages when server stream is not usable', () => {
      // Arrange - Test destroyed stream
      router.connectServer(serverIn, serverOut);
      serverIn.destroy();
      const message = '{"jsonrpc":"2.0","id":1,"method":"test"}\n';

      // Act
      clientIn.write(message);

      // Assert
      expect(messageQueue.add).toHaveBeenCalledWith(message);
      messageQueue.add.mockClear();

      // Arrange - Test non-writable stream
      const mockServerIn = new PassThrough();
      Object.defineProperty(mockServerIn, 'writable', {
        value: false,
        writable: false
      });
      router.connectServer(mockServerIn, serverOut);

      // Act
      clientIn.write(message);

      // Assert - Non-writable stream should queue
      expect(messageQueue.add).toHaveBeenCalledWith(message);
    });

    it('should not write to clientOut when it is destroyed', () => {
      // Arrange
      const mockClientOut = new PassThrough();
      const mockWrite = jest.fn<(chunk: any) => boolean>().mockReturnValue(true);
      // TypeScript limitation: overloaded signatures require type assertion
      mockClientOut.write = mockWrite as typeof mockClientOut.write;
      mockClientOut.destroy();

      const routerWithDestroyedClient = new MessageRouter(
        clientIn,
        mockClientOut,
        messageQueue as MessageQueue,
        sessionTracker as SessionTracker
      );
      routerWithDestroyedClient.connectServer(serverIn, serverOut);

      const response = '{"jsonrpc":"2.0","id":1,"result":"test"}\n';

      // Act
      serverOut.write(response);

      // Assert
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should not write to clientOut when it is not writable', () => {
      // Arrange
      const mockClientOut = new PassThrough();
      const mockWrite = jest.fn<(chunk: any) => boolean>().mockReturnValue(true);
      // TypeScript limitation: overloaded signatures require type assertion
      mockClientOut.write = mockWrite as typeof mockClientOut.write;
      Object.defineProperty(mockClientOut, 'writable', {
        value: false,
        writable: false
      });

      const routerWithNonWritableClient = new MessageRouter(
        clientIn,
        mockClientOut,
        messageQueue as MessageQueue,
        sessionTracker as SessionTracker
      );
      routerWithNonWritableClient.connectServer(serverIn, serverOut);

      const response = '{"jsonrpc":"2.0","id":1,"result":"test"}\n';

      // Act
      serverOut.write(response);

      // Assert
      expect(mockWrite).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty data chunks', () => {
      // Arrange
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));
      router.connectServer(serverIn, serverOut);

      // Act
      clientIn.write('');

      // Assert - empty strings don't emit data events in PassThrough streams
      expect(serverData).toEqual([]);
      expect(messageQueue.add).not.toHaveBeenCalled();
    });

    it('should ignore null or undefined data chunks without errors', () => {
      // Arrange
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));
      router.connectServer(serverIn, serverOut);

      // Act
      clientIn.write(Buffer.alloc(0));

      // Assert - zero-length buffers don't emit data events in PassThrough streams
      expect(serverData).toEqual([]);
      expect(messageQueue.add).not.toHaveBeenCalled();
    });

    it('should handle data chunks with only whitespace', () => {
      // Arrange
      const serverData: string[] = [];
      serverIn.on('data', chunk => serverData.push(chunk.toString()));
      router.connectServer(serverIn, serverOut);

      // Act
      const whitespaceData = '   \n\t  \n';
      clientIn.write(whitespaceData);

      // Assert
      expect(serverData).toEqual([whitespaceData]);
      expect(sessionTracker.trackInitializeRequest).not.toHaveBeenCalled();
    });

    it('should handle binary data chunks', () => {
      // Arrange
      const serverData: Buffer[] = [];
      serverIn.on('data', chunk => serverData.push(chunk));
      router.connectServer(serverIn, serverOut);

      // Act
      const binaryData = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      clientIn.write(binaryData);

      // Assert
      expect(serverData[0]).toEqual(Buffer.from(binaryData.toString()));
      expect(sessionTracker.trackInitializeRequest).not.toHaveBeenCalled();
    });
  });
});