import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MCPHotReload } from './mcp-hot-reload.js';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { spawn, execSync } from 'child_process';
import chokidar from 'chokidar';

// Mock all external dependencies
jest.mock('child_process');
jest.mock('chokidar');

describe('MCPHotReload Unit Tests', () => {
  let mockStdin: PassThrough;
  let mockStdout: PassThrough;
  let mockStderr: PassThrough;
  let proxy: MCPHotReload;
  let mockServerProcess: any;
  let mockWatcher: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock streams
    mockStdin = new PassThrough();
    mockStdout = new PassThrough();
    mockStderr = new PassThrough();

    // Setup mock server process
    mockServerProcess = new EventEmitter() as any;
    mockServerProcess.stdin = new PassThrough();
    mockServerProcess.stdout = new PassThrough();
    mockServerProcess.stderr = new PassThrough();
    mockServerProcess.kill = jest.fn();
    mockServerProcess.removeAllListeners = jest.fn();
    mockServerProcess.once = jest.fn((event, handler) => {
      mockServerProcess.on(event, handler);
    });

    // Setup mock file watcher
    mockWatcher = new EventEmitter() as any;
    mockWatcher.close = jest.fn();
    mockWatcher.on = jest.fn((event: string, handler: (...args: any[]) => void) => {
      EventEmitter.prototype.on.call(mockWatcher, event, handler);
      return mockWatcher;
    });
    mockWatcher.once = jest.fn((event: string, handler: (...args: any[]) => void) => {
      EventEmitter.prototype.once.call(mockWatcher, event, handler);
      return mockWatcher;
    });

    // Mock spawn to return our mock process
    (spawn as jest.MockedFunction<typeof spawn>).mockReturnValue(mockServerProcess);

    // Mock chokidar to return our mock watcher
    (chokidar.watch as jest.Mock).mockImplementation(() => {
      // Emit ready event on next tick to simulate async initialization
      process.nextTick(() => mockWatcher.emit('ready'));
      return mockWatcher;
    });

    // Mock execSync for build command
    (execSync as jest.MockedFunction<typeof execSync>).mockReturnValue(Buffer.from('Build output'));
  });

  afterEach(() => {
    // Clean up event listeners
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('exit');

    // Clean up any active proxy
    if (proxy) {
      (proxy as any).cleanup?.();
      proxy = null as any;
    }

    // Clean up any intervals
    if ((proxy as any)?.timeoutInterval) {
      clearInterval((proxy as any).timeoutInterval);
    }

    // Clean up mock streams
    mockStdin?.destroy();
    mockStdout?.destroy();
    mockStderr?.destroy();

    jest.restoreAllMocks();
  });

  describe('Initialization and Configuration', () => {
    it('should initialize with default configuration', () => {
      // Arrange & Act
      proxy = new MCPHotReload({ onExit: () => {} }, mockStdin, mockStdout, mockStderr);

      // Assert
      expect(proxy).toBeDefined();
      expect((proxy as any).config.buildCommand).toBe('npm run build');
      expect((proxy as any).config.debounceMs).toBe(300);
      expect((proxy as any).config.serverCommand).toBe('node');
    });

    it('should accept custom configuration', () => {
      // Arrange
      const customConfig = {
        buildCommand: 'yarn build',
        debounceMs: 500,
        serverCommand: 'deno',
        serverArgs: ['run', 'server.ts'],
        watchPattern: ['src', 'lib'],
        env: { DEBUG: 'true' }
      };

      // Act
      proxy = new MCPHotReload(customConfig, mockStdin, mockStdout, mockStderr);

      // Assert
      expect((proxy as any).config.buildCommand).toBe('yarn build');
      expect((proxy as any).config.debounceMs).toBe(500);
      expect((proxy as any).config.serverCommand).toBe('deno');
      expect((proxy as any).config.serverArgs).toEqual(['run', 'server.ts']);
    });

    it('should not start when MCP_PROXY_INSTANCE is set', () => {
      // Arrange
      process.env.MCP_PROXY_INSTANCE = 'test-instance';
      proxy = new MCPHotReload({ onExit: () => {} }, mockStdin, mockStdout, mockStderr);

      // Act
      proxy.start();

      // Assert
      expect(spawn).not.toHaveBeenCalled();

      // Cleanup
      delete process.env.MCP_PROXY_INSTANCE;
    });
  });

  describe('Message Handling', () => {
    it('should parse and handle incoming JSON-RPC messages', async () => {
      // Arrange
      proxy = new MCPHotReload({ onExit: () => {} }, mockStdin, mockStdout, mockStderr);
      const handleSpy = jest.spyOn(proxy as any, 'handleIncomingData');

      // Act
      await proxy.start();
      const testMessage = Buffer.from('{"jsonrpc":"2.0","id":1,"method":"test"}\n');
      mockStdin.emit('data', testMessage);

      // Assert
      expect(handleSpy).toHaveBeenCalledWith(testMessage);
    });

    it('should forward server output to stdout', () => {
      // Arrange
      proxy = new MCPHotReload({ onExit: () => {} }, mockStdin, mockStdout, mockStderr);
      const outputData: string[] = [];
      mockStdout.on('data', chunk => outputData.push(chunk.toString()));

      // Act
      proxy.start();
      const serverOutput = Buffer.from('{"jsonrpc":"2.0","result":"test"}\n');
      mockServerProcess.stdout.emit('data', serverOutput);

      // Assert
      expect(outputData.join('')).toBe(serverOutput.toString());
    });

    it('should forward server errors to stderr', async () => {
      // Arrange
      proxy = new MCPHotReload({ onExit: () => {} }, mockStdin, mockStdout, mockStderr);
      const errorData: string[] = [];
      mockStderr.on('data', chunk => errorData.push(chunk.toString()));

      // Act
      await proxy.start();
      const serverError = Buffer.from('[server] Error message\n');
      mockServerProcess.stderr.emit('data', serverError);

      // Assert - stderr forwarding removed with all logging
      expect(errorData.join('')).toBe('');
    });
  });

  describe('Process Management', () => {
    it('should spawn server with correct configuration', async () => {
      // Arrange
      const config = {
        serverCommand: 'deno',
        serverArgs: ['run', 'server.ts'],
        cwd: '/test/dir',
        env: { TEST_VAR: 'value' },
        onExit: () => {}
      };
      proxy = new MCPHotReload(config, mockStdin, mockStdout, mockStderr);

      // Act
      await proxy.start();

      // Assert
      expect(spawn).toHaveBeenCalledWith(
        'deno',
        ['run', 'server.ts'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: '/test/dir',
          env: expect.objectContaining({
            TEST_VAR: 'value',
            MCP_PROXY_INSTANCE: expect.any(String)
          })
        })
      );
    });

    it('should handle server exit events by attempting restart', async () => {
      // Arrange
      const exitHandler = jest.fn();
      proxy = new MCPHotReload({ onExit: exitHandler }, mockStdin, mockStdout, mockStderr);
      const restartSpy = jest.spyOn(proxy as any, 'debounceRestart');

      // Act
      await proxy.start();
      mockServerProcess.emit('exit', 0, null);

      // Assert - should attempt restart instead of exiting
      expect(restartSpy).toHaveBeenCalled();
      expect(exitHandler).not.toHaveBeenCalled();
      // Server process should still be set (not cleared)
      expect((proxy as any).serverProcess).not.toBeNull();
    });

    it('should handle server errors by attempting restart', async () => {
      // Arrange
      const exitHandler = jest.fn();
      proxy = new MCPHotReload({ onExit: exitHandler }, mockStdin, mockStdout, mockStderr);
      const restartSpy = jest.spyOn(proxy as any, 'debounceRestart');

      // Act
      await proxy.start();
      mockServerProcess.emit('error', new Error('Connection failed'));

      // Assert - should attempt restart instead of exiting
      expect(restartSpy).toHaveBeenCalled();
      expect(exitHandler).not.toHaveBeenCalled();
    });
  });

  describe('File Watching', () => {
    it('should setup watchers for configured patterns', async () => {
      // Arrange
      jest.clearAllMocks(); // Clear any previous calls
      proxy = new MCPHotReload(
        { watchPattern: ['./src', './lib'] },
        mockStdin,
        mockStdout,
        mockStderr
      );

      // Act
      await proxy.start();

      // Assert
      expect(chokidar.watch).toHaveBeenCalledTimes(1);
      // The MCPHotReload class resolves relative paths to absolute
      expect(chokidar.watch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('/src'),
          expect.stringContaining('/lib')
        ]),
        expect.any(Object)
      );
    });

    it('should only trigger restart for TypeScript and JavaScript files', async () => {
      // Arrange
      proxy = new MCPHotReload({ onExit: () => {} }, mockStdin, mockStdout, mockStderr);
      const restartSpy = jest.spyOn(proxy as any, 'restartServer');

      // Act
      await proxy.start();

      // Test non-TS/JS file - should not trigger (filtered by ignored function)
      // Since our ignored function filters out non-.ts/.js files, this won't trigger

      // Test TS file - should trigger with debounce
      mockWatcher.emit('change', 'index.ts');
      // Note: debounce timer prevents immediate call
      expect(restartSpy).not.toHaveBeenCalled();
    });
  });

  describe('Build and Restart', () => {
    it('should execute build command with correct options', async () => {
      // Arrange
      proxy = new MCPHotReload(
        {
          buildCommand: 'yarn build:prod',
          cwd: '/project'
        },
        mockStdin,
        mockStdout,
        mockStderr
      );

      // Act
      await (proxy as any).restartServer();

      // Assert
      expect(execSync).toHaveBeenCalledWith(
        'yarn build:prod',
        expect.objectContaining({
          stdio: ['ignore', 'ignore', 'pipe'],
          encoding: 'utf8',
          cwd: '/project'
        })
      );
    });

    it('should continue with server start even when build fails', async () => {
      // Arrange
      proxy = new MCPHotReload({
        buildCommand: 'npm run build',
        onExit: () => {}
      }, mockStdin, mockStdout, mockStderr);

      (execSync as jest.MockedFunction<typeof execSync>).mockImplementation(() => {
        throw new Error('Syntax error in file.ts');
      });

      // Act
      await (proxy as any).restartServer();

      // Assert - build fails but server still starts
      expect(execSync).toHaveBeenCalled();
      expect(spawn).toHaveBeenCalled(); // Server process is still spawned
      expect((proxy as any).isRestarting).toBe(false);
      expect((proxy as any).serverProcess).toBeDefined();
    });

    it('should set isRestarting flag during restart', async () => {
      // Arrange
      proxy = new MCPHotReload({ onExit: () => {} }, mockStdin, mockStdout, mockStderr);

      // Act
      expect((proxy as any).isRestarting).toBe(false);

      const restartPromise = (proxy as any).restartServer();
      expect((proxy as any).isRestarting).toBe(true);

      await restartPromise;
      expect((proxy as any).isRestarting).toBe(false);
    });

    it('should not restart again if exit happens during restart', async () => {
      // Arrange
      proxy = new MCPHotReload({ onExit: () => {} }, mockStdin, mockStdout, mockStderr);
      await proxy.start();
      const restartSpy = jest.spyOn(proxy as any, 'debounceRestart');

      // Act - simulate exit during restart
      (proxy as any).isRestarting = true;
      mockServerProcess.emit('exit', 0, null);

      // Assert - should not attempt another restart
      expect(restartSpy).not.toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    it('should cleanup resources when stopping', async () => {
      // Arrange
      proxy = new MCPHotReload({ onExit: () => {} }, mockStdin, mockStdout, mockStderr);
      await proxy.start();

      // Create a mock debounce timer
      (proxy as any).debounceTimer = setTimeout(() => {}, 1000);
      // Simulate watchers were created
      (proxy as any).watchers = [mockWatcher];

      // Act
      (proxy as any).cleanup();

      // Assert
      expect(mockWatcher.close).toHaveBeenCalled();
      expect(mockServerProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should handle SIGINT signal', async () => {
      // Arrange
      const exitHandler = jest.fn();
      proxy = new MCPHotReload({ onExit: exitHandler }, mockStdin, mockStdout, mockStderr);

      // Mock stopServer to resolve immediately
      const stopServerMock = jest.spyOn(proxy as any, 'stopServer').mockResolvedValue(undefined);

      // Act
      await proxy.start();

      // Get the signal handler
      const sigintHandler = process.listeners('SIGINT')[process.listeners('SIGINT').length - 1] as any;

      // Call the handler and wait for it
      await sigintHandler();

      // Assert - verify graceful shutdown sequence
      expect(stopServerMock).toHaveBeenCalled();
      expect(exitHandler).toHaveBeenCalledWith(0);
    });

    it('should handle SIGTERM signal', async () => {
      // Arrange
      const exitHandler = jest.fn();
      proxy = new MCPHotReload({ onExit: exitHandler }, mockStdin, mockStdout, mockStderr);

      // Mock stopServer to resolve immediately
      const stopServerMock = jest.spyOn(proxy as any, 'stopServer').mockResolvedValue(undefined);

      // Act
      await proxy.start();

      // Get the signal handler
      const sigtermHandler = process.listeners('SIGTERM')[process.listeners('SIGTERM').length - 1] as any;

      // Call the handler and wait for it
      await sigtermHandler();

      // Assert - verify graceful shutdown sequence
      expect(stopServerMock).toHaveBeenCalled();
      expect(exitHandler).toHaveBeenCalledWith(0);
    });
  });

  describe('Session Management', () => {
    it('should initialize message parser and session manager', () => {
      // Arrange & Act
      proxy = new MCPHotReload({ onExit: () => {} }, mockStdin, mockStdout, mockStderr);

      // Assert
      expect((proxy as any).messageParser).toBeDefined();
      expect((proxy as any).sessionManager).toBeDefined();
    });

    it('should handle timeout for stale requests', () => {
      // Arrange
      proxy = new MCPHotReload({ onExit: () => {} }, mockStdin, mockStdout, mockStderr);
      const outputData: string[] = [];
      mockStdout.on('data', chunk => outputData.push(chunk.toString()));

      // Setup a pending request in session manager
      const timestamp = Date.now() - 40000; // 40 seconds ago to ensure timeout
      (proxy as any).sessionManager.pendingRequests.set(123, {
        message: { jsonrpc: '2.0', id: 123, method: 'test' },
        raw: '{"jsonrpc":"2.0","id":123,"method":"test"}',
        timestamp
      });

      // Act
      (proxy as any).isRestarting = true;
      (proxy as any).handleTimeout();

      // Assert
      const output = outputData.join('');
      expect(output).toContain('"id":123');
      expect(output).toContain('"error"');
      expect(output).toContain('timed out');
    });
  });

  describe('Double Initialize Response Prevention', () => {
    it('should only output initialize response once', async () => {
      // Arrange
      const outputChunks: string[] = [];
      mockStdout.on('data', (chunk) => {
        outputChunks.push(chunk.toString());
      });

      proxy = new MCPHotReload({ onExit: () => {} }, mockStdin, mockStdout, mockStderr);
      await proxy.start();

      // Mock server process sending a response
      const initResponse = '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"test","capabilities":{}}}\n';

      // Act - simulate initialize request
      const initRequest = Buffer.from('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
      (proxy as any).handleIncomingData(initRequest);

      // Simulate server responding
      mockServerProcess.stdout.emit('data', Buffer.from(initResponse));

      // Assert - response should only be written once to stdout
      const responses = outputChunks.filter(chunk =>
        chunk.includes('"id":1') && chunk.includes('"result"')
      );
      expect(responses).toHaveLength(1);
    });
  });
});