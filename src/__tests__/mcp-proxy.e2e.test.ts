import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import { MCPProxyFactory } from '../factory/mcp-proxy-factory.js';
import { MCPProxy } from '../mcp-proxy.js';
import { createTestDirectory, cleanupTestDirectory } from './utils/test-directory.js';
import fixtures from './fixtures/test-fixtures.js';
import { MCPTestClient } from './utils/mcp-test-client.js';
import {
  createInitializeRequest,
  createToolCallRequest,
  createToolsListRequest,
  createRequest
} from './utils/mcp-test-messages.js';

/**
 * Simple E2E tests without unnecessary abstractions.
 * Tests real MCP proxy behavior with actual processes.
 */
describe.sequential('MCPProxy E2E Tests', () => {
  let testDir: string;
  let proxy: MCPProxy | null = null;
  let stdin: PassThrough;
  let stdout: PassThrough;
  let messages: any[] = [];
  let rawOutput: string[] = [];

  beforeEach(() => {
    testDir = createTestDirectory('mcp-proxy-e2e');
    stdin = new PassThrough();
    stdout = new PassThrough();
    messages = [];
    rawOutput = [];

    // Collect all messages from stdout
    stdout.on('data', (chunk) => {
      const chunkStr = chunk.toString();
      rawOutput.push(chunkStr);
      const lines = chunkStr.split('\n').filter((line: string) => line.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          messages.push(msg);
          // console.error('Parsed message:', JSON.stringify(msg));
        } catch (e) {
          console.error('Failed to parse line:', line);
        }
      }
    });
  });

  afterEach(async () => {
    if (proxy) {
      proxy.cleanup();

      // Force kill the server process if it exists
      const lifecycle = (proxy as any).serverLifecycle;
      const process = lifecycle?.currentProcess;
      if (process && !process.killed) {
        process.kill('SIGKILL');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    proxy = null;
    cleanupTestDirectory(testDir);
  });

  describe('Basic Functionality', () => {
    it('should start server and handle initialize request', async () => {
      // Arrange
      proxy = MCPProxyFactory.create(
        {
          serverCommand: 'node',
          serverArgs: [fixtures.TEST_SERVERS.REAL_MCP],
          cwd: fixtures.PROJECT_ROOT,
          onExit: () => {}
        },
        stdin,
        stdout
      );

      // Act
      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 1000));

      stdin.write(createInitializeRequest(1));

      await new Promise(resolve => setTimeout(resolve, 1500));

      // Assert
      const initResponse = messages.find(m => m.id === 1);
      if (!initResponse) {
        console.error('Raw output:', rawOutput.join(''));
        console.error('Messages:', messages);
      }
      expect(initResponse).toBeDefined();
      expect(initResponse.result?.serverInfo?.name).toBe('test-mcp-server');
    });

    it('should handle tool calls', async () => {
      // Arrange
      proxy = MCPProxyFactory.create(
        {
          serverCommand: 'node',
          serverArgs: [fixtures.TEST_SERVERS.REAL_MCP],
          cwd: fixtures.PROJECT_ROOT,
          onExit: () => {}
        },
        stdin,
        stdout
      );

      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Initialize first
      stdin.write(createInitializeRequest(1));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Act - Call echo tool
      stdin.write(createToolCallRequest(2, 'echo', { message: 'Hello E2E' }));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const toolResponse = messages.find(m => m.id === 2);
      expect(toolResponse).toBeDefined();
      expect(toolResponse.result?.content[0]?.text).toBe('Echo: Hello E2E');
    });
  });

  describe('Hot Reload', () => {
    it('should restart server on file change', async () => {
      // Arrange
      const serverTemplate = fs.readFileSync(fixtures.TEST_SERVERS.VERSIONED_TEST, 'utf-8');
      const serverPath = path.join(testDir, 'server.mjs');
      fs.writeFileSync(serverPath, serverTemplate.replace(/VERSION_PLACEHOLDER/g, '1.0.0'));

      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      const watchFile = path.join(testDir, 'src/test.ts');
      fs.writeFileSync(watchFile, '// v1');

      proxy = MCPProxyFactory.create(
        {
          serverCommand: 'node',
          serverArgs: ['server.mjs'],
          cwd: testDir,
          watchPattern: path.join(testDir, 'src'),
          debounceMs: 200,
          buildCommand: 'echo "Building"',
          onExit: () => {}
        },
        stdin,
        stdout
      );

      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Initialize
      stdin.write(createInitializeRequest(1));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify v1
      stdin.write(createToolsListRequest(2));
      await new Promise(resolve => setTimeout(resolve, 500));

      const v1Tools = messages.find(m => m.id === 2);
      expect(v1Tools?.result?.tools[0]?.description).toContain('version 1.0.0');

      // Act - Update server and trigger change
      fs.writeFileSync(serverPath, serverTemplate.replace(/VERSION_PLACEHOLDER/g, '2.0.0'));
      fs.writeFileSync(watchFile, '// v2');

      // Wait for restart
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Request tools again
      stdin.write(createToolsListRequest(3));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const v2Tools = messages.find(m => m.id === 3);
      expect(v2Tools?.result?.tools[0]?.description).toContain('version 2.0.0');
    });
  });

  describe('Error Handling', () => {
    it('should send error when server crashes with pending request', async () => {
      // Arrange
      proxy = MCPProxyFactory.create(
        {
          serverCommand: 'node',
          serverArgs: [fixtures.TEST_SERVERS.CRASH_ON_METHOD],
          cwd: fixtures.PROJECT_ROOT,
          onExit: () => {}
        },
        stdin,
        stdout
      );

      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Initialize
      stdin.write(createInitializeRequest(1));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Act - Send crash request
      stdin.write(createRequest(2, 'crash', {}));
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Assert
      const errorResponse = messages.find(m => m.id === 2 && m.error);
      expect(errorResponse).toBeDefined();
      expect(errorResponse.error.code).toBe(-32603);
      expect(errorResponse.error.message).toContain('terminated unexpectedly');
      expect(errorResponse.error.message).toContain('exit code 42');
    });
  });

  describe('Signal Handling', () => {
    it('should exit quickly on SIGINT', async () => {
      // Arrange
      const client = new MCPTestClient();

      await client.start({
        proxyPath: path.resolve('dist/index.js'),
        serverCommand: 'node',
        serverArgs: [fixtures.TEST_SERVERS.SIGNAL_TEST],
        cwd: testDir
      });

      await new Promise(resolve => setTimeout(resolve, 500));
      expect(client.isRunning()).toBe(true);

      // Act
      const startTime = Date.now();
      client.sendSignal('SIGINT');
      const { code } = await client.waitForExit(1000);
      const elapsed = Date.now() - startTime;

      // Assert
      expect(elapsed).toBeLessThan(250);
      expect(code).toBe(0);
      expect(client.isRunning()).toBe(false);

      // Cleanup
      client.cleanup();
    });
  });
});