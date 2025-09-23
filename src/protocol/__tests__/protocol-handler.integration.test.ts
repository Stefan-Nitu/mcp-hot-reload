import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProtocolHandler } from '../protocol-handler.js';
import { ServerConnection, ServerConnectionImpl } from '../../process/server-connection.js';
import { spawn, ChildProcess } from 'child_process';
import { PassThrough } from 'stream';
import fixtures from '../../__tests__/fixtures/test-fixtures.js';
import { cleanupProxyProcess } from '../../__tests__/utils/process-cleanup.js';

/**
 * ProtocolHandler Integration Tests
 *
 * Tests the complete protocol handler behavior with real processes,
 * ensuring no duplicate connections and proper session management
 * during hot-reload scenarios.
 */
describe.sequential('ProtocolHandler Integration Tests', () => {
  let clientIn: PassThrough;
  let clientOut: PassThrough;
  let handler: ProtocolHandler;
  let serverProcess: ChildProcess | null = null;
  let serverConnection: ServerConnection | null = null;

  beforeEach(() => {
    clientIn = new PassThrough();
    clientOut = new PassThrough();
    handler = new ProtocolHandler(clientIn, clientOut);
  });

  afterEach(async () => {
    // Clean up
    handler.shutdown();
    if (serverProcess) {
      await cleanupProxyProcess(serverProcess);
      serverProcess = null;
    }
    serverConnection = null;
  });

  describe('Connection Management', () => {
    it('should only create one connection per server restart', async () => {
      // Arrange
      const connectCount = { count: 0 };
      const originalConnect = handler.connectServer.bind(handler);

      // Track connectServer calls
      handler.connectServer = vi.fn((connection: ServerConnection) => {
        connectCount.count++;
        console.error(`[TEST] connectServer called (count: ${connectCount.count})`);
        return originalConnect(connection);
      });

      // Start first server
      serverProcess = spawn('node', [fixtures.TEST_SERVERS.SIMPLE_ECHO], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LOG_LEVEL: 'debug' }
      });

      serverConnection = new ServerConnectionImpl(
        serverProcess.stdin!,
        serverProcess.stdout!,
        serverProcess.pid!,
        serverProcess
      );
      handler.connectServer(serverConnection);

      // Send initialize
      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '1.0.0', capabilities: {} },
        id: 1
      }) + '\n';

      clientIn.write(initRequest);

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert - Initial connection count
      expect(connectCount.count).toBe(1);

      // Act - Simulate restart by disconnecting and reconnecting
      handler.disconnectServer();

      // Clean up old process
      await cleanupProxyProcess(serverProcess);

      // Start new server
      serverProcess = spawn('node', [fixtures.TEST_SERVERS.SIMPLE_ECHO], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, LOG_LEVEL: 'debug' }
      });

      serverConnection = new ServerConnectionImpl(
        serverProcess.stdin!,
        serverProcess.stdout!,
        serverProcess.pid!,
        serverProcess
      );
      handler.connectServer(serverConnection);

      // Wait for re-initialization
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert - Should have exactly one more connection, not two
      expect(connectCount.count).toBe(2);
    });

    it('should not create duplicate data listeners after restart', async () => {
      // Arrange
      const listenerCounts = { stdout: 0, stderr: 0 };

      // Start server
      serverProcess = spawn('node', [fixtures.TEST_SERVERS.SIMPLE_ECHO], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      serverConnection = new ServerConnectionImpl(
        serverProcess.stdin!,
        serverProcess.stdout!,
        serverProcess.pid!,
        serverProcess
      );

      // Track listener additions
      const originalStdoutOn = serverProcess.stdout!.on;
      serverProcess.stdout!.on = vi.fn(function(this: any, event: string, listener: any) {
        if (event === 'data') {
          listenerCounts.stdout++;
          console.error(`[TEST] stdout data listener added (count: ${listenerCounts.stdout})`);
        }
        return originalStdoutOn.apply(this, [event, listener]);
      }) as any;

      // Connect
      handler.connectServer(serverConnection);

      // Initialize
      clientIn.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '1.0.0' },
        id: 1
      }) + '\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert - Initial listener count
      expect(listenerCounts.stdout).toBe(1);

      // Act - Restart
      handler.disconnectServer();
      await cleanupProxyProcess(serverProcess);

      // Start new server
      serverProcess = spawn('node', [fixtures.TEST_SERVERS.SIMPLE_ECHO], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      serverConnection = new ServerConnectionImpl(
        serverProcess.stdin!,
        serverProcess.stdout!,
        serverProcess.pid!,
        serverProcess
      );

      // Track new server's listeners
      listenerCounts.stdout = 0; // Reset for new process
      const newOriginalOn = serverProcess.stdout!.on;
      serverProcess.stdout!.on = vi.fn(function(this: any, event: string, listener: any) {
        if (event === 'data') {
          listenerCounts.stdout++;
          console.error(`[TEST] New stdout data listener added (count: ${listenerCounts.stdout})`);
        }
        return newOriginalOn.apply(this, [event, listener]);
      }) as any;

      handler.connectServer(serverConnection);

      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert - New server should have exactly one listener
      expect(listenerCounts.stdout).toBe(1);
    });
  });

  describe('Session Preservation', () => {
    it('should preserve session state across restarts', async () => {
      // Arrange
      serverProcess = spawn('node', [fixtures.TEST_SERVERS.SIMPLE_ECHO], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      serverConnection = new ServerConnectionImpl(
        serverProcess.stdin!,
        serverProcess.stdout!,
        serverProcess.pid!,
        serverProcess
      );
      handler.connectServer(serverConnection);

      // Capture client responses
      const clientResponses: string[] = [];
      clientOut.on('data', (chunk) => {
        clientResponses.push(chunk.toString());
      });

      // Initialize
      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '1.0.0',
          capabilities: { tools: {} }
        },
        id: 1
      }) + '\n';

      clientIn.write(initRequest);

      // Wait for init response
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify initialized
      expect(handler.getSessionState().initialized).toBe(true);
      expect(handler.getSessionState().initializeRequest).toEqual(initRequest);

      const responseCount = clientResponses.length;

      // Act - Restart preserving session
      handler.disconnectServer();
      await cleanupProxyProcess(serverProcess);

      // Start new server
      serverProcess = spawn('node', [fixtures.TEST_SERVERS.SIMPLE_ECHO], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      serverConnection = new ServerConnectionImpl(
        serverProcess.stdin!,
        serverProcess.stdout!,
        serverProcess.pid!,
        serverProcess
      );
      handler.connectServer(serverConnection);

      // Wait for automatic re-initialization
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert - Session preserved
      expect(handler.getSessionState().initialized).toBe(true);
      expect(handler.getSessionState().initializeRequest).toEqual(initRequest);

      // Should have gotten another init response from new server
      expect(clientResponses.length).toBeGreaterThan(responseCount);
    });

    it('should queue messages during restart and replay them', async () => {
      // Arrange
      serverProcess = spawn('node', [fixtures.TEST_SERVERS.SIMPLE_ECHO], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      serverConnection = new ServerConnectionImpl(
        serverProcess.stdin!,
        serverProcess.stdout!,
        serverProcess.pid!,
        serverProcess
      );
      handler.connectServer(serverConnection);

      // Initialize
      clientIn.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '1.0.0' },
        id: 1
      }) + '\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      // Disconnect to simulate restart
      handler.disconnectServer();

      // Act - Send messages while disconnected
      const toolCall1 = JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 2
      }) + '\n';

      const toolCall2 = JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'echo' },
        id: 3
      }) + '\n';

      clientIn.write(toolCall1);
      clientIn.write(toolCall2);

      // Verify messages are queued
      expect(handler.getQueueSize()).toBeGreaterThan(0);

      // Clean up old process
      await cleanupProxyProcess(serverProcess);

      // Reconnect with new server
      serverProcess = spawn('node', [fixtures.TEST_SERVERS.SIMPLE_ECHO], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Capture what's sent to server by spying on stdin.write
      const serverData: string[] = [];
      const originalWrite = serverProcess.stdin!.write.bind(serverProcess.stdin!);
      serverProcess.stdin!.write = vi.fn(function(this: any, chunk: any, encodingOrCallback?: any, callback?: any) {
        serverData.push(chunk.toString());
        // Call the original write with the same arguments
        if (typeof encodingOrCallback === 'function') {
          return originalWrite(chunk, encodingOrCallback);
        } else if (callback) {
          return originalWrite(chunk, encodingOrCallback, callback);
        } else if (encodingOrCallback) {
          return originalWrite(chunk, encodingOrCallback);
        } else {
          return originalWrite(chunk);
        }
      }) as any;

      serverConnection = new ServerConnectionImpl(
        serverProcess.stdin!,
        serverProcess.stdout!,
        serverProcess.pid!,
        serverProcess
      );

      handler.connectServer(serverConnection);

      // Wait for replay
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert - Initialize replayed first, then queued messages
      expect(serverData.length).toBeGreaterThanOrEqual(3);
      expect(serverData[0]).toContain('"method":"initialize"');

      // Queued messages should be replayed
      const allServerData = serverData.join('');
      expect(allServerData).toContain('"method":"tools/list"');
      expect(allServerData).toContain('"method":"tools/call"');
    });
  });

  describe('Error Recovery', () => {
    it('should handle server crash and notify client', async () => {
      // Arrange
      serverProcess = spawn('node', [fixtures.TEST_SERVERS.CRASH_AFTER_INIT], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      serverConnection = new ServerConnectionImpl(
        serverProcess.stdin!,
        serverProcess.stdout!,
        serverProcess.pid!,
        serverProcess
      );
      handler.connectServer(serverConnection);

      const clientResponses: string[] = [];
      clientOut.on('data', chunk => clientResponses.push(chunk.toString()));

      // Initialize and send a request
      clientIn.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '1.0.0' },
        id: 1
      }) + '\n');

      await new Promise(resolve => setTimeout(resolve, 100));

      // Send a request that will be pending when crash occurs
      clientIn.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'test' },
        id: 2
      }) + '\n');

      // Wait for crash (server crashes 100ms after init)
      await new Promise(resolve => setTimeout(resolve, 200));

      // Assert - Should have error response for pending request
      const errorResponse = clientResponses.find(r => r.includes('"error"'));
      expect(errorResponse).toBeDefined();

      if (errorResponse) {
        const parsed = JSON.parse(errorResponse);
        expect(parsed.id).toBe(2);
        expect(parsed.error).toBeDefined();
        expect(parsed.error.message).toContain('terminated unexpectedly');
      }
    });
  });
});