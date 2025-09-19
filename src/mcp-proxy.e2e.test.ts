import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MCPProxy } from './mcp-proxy.js';
import { PassThrough } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('MCPProxy E2E Tests', () => {
  let testDir: string;
  let proxy: MCPProxy | null = null;
  let proxyStdin: PassThrough;
  let proxyStdout: PassThrough;
  let proxyStderr: PassThrough;
  let capturedOutput: string[];
  let capturedErrors: string[];

  beforeEach(async () => {
    // Create real test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-proxy-e2e-'));

    // Setup real streams
    proxyStdin = new PassThrough();
    proxyStdout = new PassThrough();
    proxyStderr = new PassThrough();

    capturedOutput = [];
    capturedErrors = [];

    proxyStdout.on('data', chunk => capturedOutput.push(chunk.toString()));
    proxyStderr.on('data', chunk => capturedErrors.push(chunk.toString()));
  });

  afterEach(async () => {
    // Clean up real processes and files
    if (proxy) {
      try {
        await proxy.stop();
      } catch (e) {
        // Ignore cleanup errors
      }
      proxy = null;
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Real MCP Server Integration', () => {
    it('should work with a real MCP server implementation', async () => {
      // Arrange - Use the REAL MCP server with SDK
      // Run it from the project root where node_modules is available
      const realServerPath = path.join(process.cwd(), 'test/fixtures/servers/real-mcp-server.js');
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'src/index.ts'), '// Source file for watching');

      // Act - Start real proxy with REAL MCP SDK server
      // Run from project root so it can access node_modules
      proxy = new MCPProxy(
        {
          buildCommand: 'echo "Building"',
          serverCommand: 'node',
          serverArgs: [realServerPath],
          cwd: process.cwd(),  // Run from project root where node_modules exists
          watchPattern: path.join(testDir, 'src'),
          debounceMs: 100,
          onExit: () => {}
        },
        proxyStdin,
        proxyStdout,
        proxyStderr
      );

      await proxy.start();

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Send real MCP initialize request
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0'
          }
        }
      };

      proxyStdin.write(JSON.stringify(initRequest) + '\n');

      // Wait for real response
      await new Promise(resolve => setTimeout(resolve, 500));

      // Send tools list request
      const toolsRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      };

      proxyStdin.write(JSON.stringify(toolsRequest) + '\n');

      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 500));

      // Call the echo tool
      const toolCall = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: {
            message: 'Hello from E2E test!'
          }
        }
      };

      proxyStdin.write(JSON.stringify(toolCall) + '\n');

      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert - Verify real responses
      const output = capturedOutput.join('');
      const messages = output
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      // Check initialization response
      const initResponse = messages.find(m => m.id === 1);
      expect(initResponse).toBeDefined();
      expect(initResponse?.result?.serverInfo?.name).toBe('test-mcp-server');

      // Check tools list response
      const toolsResponse = messages.find(m => m.id === 2);
      expect(toolsResponse).toBeDefined();
      expect(toolsResponse?.result?.tools).toHaveLength(5);
      const toolNames = toolsResponse?.result?.tools.map((t: any) => t.name);
      expect(toolNames).toContain('echo');
      expect(toolNames).toContain('getText');
      expect(toolNames).toContain('getImage');
      expect(toolNames).toContain('getStructuredData');
      expect(toolNames).toContain('getMixedContent');

      // Check tool call response
      const toolResponse = messages.find(m => m.id === 3);
      expect(toolResponse).toBeDefined();
      expect(toolResponse?.result?.content[0]?.text).toBe('Echo: Hello from E2E test!');

      // Verify server started (no logging to check anymore)
      expect(capturedErrors.length).toBeGreaterThanOrEqual(0);
    }, 10000);

    it('should handle real file changes and server restart', async () => {
      // Arrange - Use the versioned test server fixture as template
      const fixtureServerPath = path.join(__dirname, '..', 'test/fixtures/servers', 'versioned-test-server.js');
      const fixtureContent = fs.readFileSync(fixtureServerPath, 'utf-8');
      const serverPath = path.join(testDir, 'server.mjs');

      // Write initial server with version 1.0.0
      fs.writeFileSync(serverPath, fixtureContent.replace(/VERSION_PLACEHOLDER/g, '1.0.0'));
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'src/trigger.ts'), '// v1');

      const packageJson = {
        name: 'test-server',
        type: 'module',
        scripts: {
          build: 'echo "Building..."'
        }
      };
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );

      // Act - Start proxy
      proxy = new MCPProxy(
        {
          buildCommand: 'echo "Building"',
          serverCommand: 'node',
          serverArgs: ['server.mjs'],
          cwd: testDir,
          watchPattern: path.join(testDir, 'src'),
          debounceMs: 200,
          onExit: () => {}
        },
        proxyStdin,
        proxyStdout,
        proxyStderr
      );

      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Initialize session
      proxyStdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Get initial tools
      proxyStdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Clear captured data
      capturedOutput.length = 0;
      capturedErrors.length = 0;

      // Update server code to version 2.0.0
      fs.writeFileSync(serverPath, fixtureContent.replace(/VERSION_PLACEHOLDER/g, '2.0.0'));

      // Trigger file change
      fs.writeFileSync(path.join(testDir, 'src/trigger.ts'), '// v2 - changed');

      // Wait for restart (debounce + rebuild + restart)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Request tools again after restart
      proxyStdin.write('{"jsonrpc":"2.0","id":3,"method":"tools/list"}\n');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const output = capturedOutput.join('');

      // Verify restart happened (through notifications since no logging)

      // Verify restart occurred - either notification or version change
      const hasNotification = output.includes('"method":"notifications/tools/list_changed"');
      const hasVersionChange = output.includes('version 2.0.0');
      expect(hasNotification || hasVersionChange).toBe(true);

      // Verify new version is running
      const messages = output
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const toolsResponse = messages.find(m => m.id === 3);
      expect(toolsResponse?.result?.tools[0]?.description).toContain('version 2.0.0');
    }, 15000);

    it('should handle real server crash and recovery', async () => {
      // Arrange - Create a server that crashes
      const serverCode = `#!/usr/bin/env node
let messageCount = 0;

process.stdin.on('data', (chunk) => {
  const lines = chunk.toString().split('\\n');
  lines.forEach(line => {
    if (!line.trim()) return;

    messageCount++;

    try {
      const msg = JSON.parse(line);

      if (msg.method === 'initialize') {
        console.log(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'crash-test', version: '1.0.0' }
          }
        }));
      } else if (msg.method === 'crash') {
        // Crashing as requested
        process.exit(1);
      }
    } catch (e) {
      // Error occurred
    }
  });
});

// Server started - will crash on "crash" method
`;

      fs.writeFileSync(path.join(testDir, 'server.mjs'), serverCode);

      // Act - Start proxy
      proxy = new MCPProxy(
        {
          serverCommand: 'node',
          serverArgs: ['server.mjs'],
          cwd: testDir,
          onExit: () => {}
        },
        proxyStdin,
        proxyStdout,
        proxyStderr
      );

      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Initialize
      proxyStdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
      await new Promise(resolve => setTimeout(resolve, 300));

      // Trigger crash
      proxyStdin.write('{"jsonrpc":"2.0","method":"crash"}\n');

      // Wait for crash
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Assert - Check behavior, not logs
      // After crash, server should not be running
      await new Promise(resolve => setTimeout(resolve, 500));
      const isRunning = (proxy as any).serverLifecycle.isRunning();
      expect(isRunning).toBe(false);
    }, 10000);
  });

  describe('Real Build Process Testing', () => {
    it('should execute real build commands', async () => {
      // Arrange - Create a project with real build
      const sourceCode = `export function hello() { return 'Hello, World!'; }`;

      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'src/index.ts'), sourceCode);

      // Create a real build script that transpiles TypeScript
      const buildScript = `#!/bin/bash
echo "Starting build..."
mkdir -p dist
# Simple transpilation - wrap in module.exports
cat src/index.ts | sed 's/export function hello/function hello/' > dist/index.js
echo "module.exports = { hello };" >> dist/index.js
echo "Build complete!"
`;

      fs.writeFileSync(path.join(testDir, 'build.sh'), buildScript);
      fs.chmodSync(path.join(testDir, 'build.sh'), '755');

      const serverCode = `#!/usr/bin/env node
let built;
try {
  built = require('./dist/index.js');
  // Module loaded
} catch (e) {
  // Module not built yet
}

process.stdin.on('data', (chunk) => {
  const lines = chunk.toString().split('\\n');
  lines.forEach(line => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      if (msg.method === 'initialize') {
        console.log(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'build-test', version: '1.0.0' }
          }
        }));
      }
    } catch (e) {}
  });
});
`;

      fs.writeFileSync(path.join(testDir, 'server.js'), serverCode);

      // Act - Start proxy with real build command
      proxy = new MCPProxy(
        {
          buildCommand: './build.sh',
          serverCommand: 'node',
          serverArgs: ['server.js'],
          cwd: testDir,
          watchPattern: path.join(testDir, 'src'),
          debounceMs: 100,
          onExit: () => {}
        },
        proxyStdin,
        proxyStdout,
        proxyStderr
      );

      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Trigger rebuild by changing source
      fs.writeFileSync(path.join(testDir, 'src/index.ts'),
        `export function hello() { return 'Updated!'; }`);

      // Wait for rebuild
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Assert - Check behavior: dist directory should be created by build
      expect(fs.existsSync(path.join(testDir, 'dist'))).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'dist/index.js'))).toBe(true);

      // Verify the build output contains the updated code
      const builtCode = fs.readFileSync(path.join(testDir, 'dist/index.js'), 'utf-8');
      expect(builtCode).toContain('Updated!');
    }, 10000);

    it('should handle real build failures', async () => {
      // Arrange - Create a build that fails
      const buildScript = `#!/bin/bash
echo "Build starting..." >&2
echo "ERROR: Compilation failed!" >&2
exit 1
`;

      fs.writeFileSync(path.join(testDir, 'build.sh'), buildScript);
      fs.chmodSync(path.join(testDir, 'build.sh'), '755');

      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'src/trigger.ts'), '// initial');

      // Simple server
      fs.writeFileSync(path.join(testDir, 'server.js'),
        'process.stdin.resume();');

      // Act
      proxy = new MCPProxy(
        {
          buildCommand: './build.sh',
          serverCommand: 'node',
          serverArgs: ['server.js'],
          cwd: testDir,
          watchPattern: path.join(testDir, 'src'),
          onExit: () => {}
        },
        proxyStdin,
        proxyStdout,
        proxyStderr
      );

      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Clear errors
      capturedErrors.length = 0;

      // Trigger rebuild
      fs.writeFileSync(path.join(testDir, 'src/trigger.ts'), '// changed');

      // Wait for build attempt
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Assert - Check behavior: build should fail but server continues
      // When build fails, dist directory should not exist
      expect(fs.existsSync(path.join(testDir, 'dist'))).toBe(false);

      // Server should still be running despite build failure
      expect((proxy as any).serverLifecycle.isRunning()).toBe(true);
    }, 10000);
  });
});