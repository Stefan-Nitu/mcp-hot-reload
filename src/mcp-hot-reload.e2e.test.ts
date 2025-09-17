import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MCPHotReload } from './mcp-hot-reload.js';
import { spawn, ChildProcess } from 'child_process';
import { PassThrough } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('MCPHotReload Real E2E Tests', () => {
  let testDir: string;
  let proxy: MCPHotReload | null = null;
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
      await proxy.stop();
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
      proxy = new MCPHotReload(
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

      // Verify stderr has proxy logs
      const errors = capturedErrors.join('');
      expect(errors).toContain('[mcp-hot-reload] Starting server');
      expect(errors).toContain('[mcp-hot-reload] Watching');
    }, 10000);

    it('should handle real file changes and server restart', async () => {
      // Arrange - Create a simple real server
      const createServerCode = (version: string) => `#!/usr/bin/env node
console.error('[server] Version: ${version}');

process.stdin.on('data', (chunk) => {
  const lines = chunk.toString().split('\\n');
  lines.forEach(line => {
    if (!line.trim()) return;

    try {
      const msg = JSON.parse(line);

      if (msg.method === 'initialize') {
        const response = {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: {
              name: 'test-server',
              version: '${version}'
            }
          }
        };
        console.log(JSON.stringify(response));
      } else if (msg.method === 'tools/list') {
        const response = {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [{
              name: 'version_tool',
              description: 'Returns version ${version}'
            }]
          }
        };
        console.log(JSON.stringify(response));
      }
    } catch (e) {
      console.error('[server] Parse error:', e);
    }
  });
});
`;

      // Write initial server
      fs.writeFileSync(path.join(testDir, 'server.mjs'), createServerCode('1.0.0'));
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
      proxy = new MCPHotReload(
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

      // Update server code
      fs.writeFileSync(path.join(testDir, 'server.mjs'), createServerCode('2.0.0'));

      // Trigger file change
      fs.writeFileSync(path.join(testDir, 'src/trigger.ts'), '// v2 - changed');

      // Wait for restart (debounce + rebuild + restart)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Request tools again after restart
      proxyStdin.write('{"jsonrpc":"2.0","id":3,"method":"tools/list"}\n');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const output = capturedOutput.join('');
      const errors = capturedErrors.join('');

      // Verify restart happened
      expect(errors).toContain('Change detected');
      expect(errors).toContain('Build complete');
      expect(errors).toContain('[mcp-hot-reload] Change detected, restarting');

      // Verify tools/list_changed notification was sent
      expect(output).toContain('notifications/tools/list_changed');

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
        console.error('[server] Crashing as requested!');
        process.exit(1);
      }
    } catch (e) {
      console.error('[server] Error:', e);
    }
  });
});

console.error('[server] Started - will crash on "crash" method');
`;

      fs.writeFileSync(path.join(testDir, 'server.mjs'), serverCode);

      // Act - Start proxy
      proxy = new MCPHotReload(
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

      // Assert
      const errors = capturedErrors.join('');
      expect(errors).toContain('Server exited');
      expect(errors).toContain('[server] Crashing as requested');

      // Verify proxy detected the crash
      const serverProcess = (proxy as any).serverProcess;
      expect(serverProcess).toBeNull();
    }, 10000);
  });

  describe('Real Build Process Testing', () => {
    it('should execute real build commands', async () => {
      // Arrange - Create a project with real build
      const sourceCode = `export function hello() { return 'Hello, World!'; }`;

      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'src/index.ts'), sourceCode);

      // Create a real build script
      const buildScript = `#!/bin/bash
echo "Starting build..."
mkdir -p dist
echo "module.exports = { hello: () => 'Built!' };" > dist/index.js
echo "Build complete!"
`;

      fs.writeFileSync(path.join(testDir, 'build.sh'), buildScript);
      fs.chmodSync(path.join(testDir, 'build.sh'), '755');

      const serverCode = `#!/usr/bin/env node
let built;
try {
  built = require('./dist/index.js');
  console.error('[server] Loaded built module:', built.hello());
} catch (e) {
  console.error('[server] Module not built yet');
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
      proxy = new MCPHotReload(
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

      // Assert
      const errors = capturedErrors.join('');
      expect(errors).toContain('[mcp-hot-reload] Running build');
      expect(errors).toContain('[mcp-hot-reload] Build complete');

      // Verify dist was created
      expect(fs.existsSync(path.join(testDir, 'dist/index.js'))).toBe(true);
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
        'console.error("[server] Running"); process.stdin.resume();');

      // Act
      proxy = new MCPHotReload(
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

      // Assert
      const errors = capturedErrors.join('');
      expect(errors).toContain('Build failed');
      expect(errors).toContain('ERROR: Compilation failed!');

      // Server should still be running (didn't restart due to build failure)
      expect((proxy as any).isRestarting).toBe(false);
    }, 10000);
  });
});