import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MCPHotReload } from './mcp-hot-reload.js';
import { Readable, Writable, PassThrough } from 'stream';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('MCPHotReload - Double Response Prevention', () => {
  let mockStdin: PassThrough;
  let mockStdout: PassThrough;
  let mockStderr: PassThrough;
  let proxy: MCPHotReload;
  let testDir: string;
  let serverFile: string;
  let exitHandler: jest.Mock;

  beforeEach(() => {
    mockStdin = new PassThrough();
    mockStdout = new PassThrough();
    mockStderr = new PassThrough();
    exitHandler = jest.fn();

    // Create a test directory with a simple echo server
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    serverFile = path.join(testDir, 'server.js');

    // Create a test server that responds to initialize
    const serverCode = `
      process.stdin.on('data', (data) => {
        const messages = data.toString().split('\\n').filter(line => line.trim());
        messages.forEach(line => {
          try {
            const msg = JSON.parse(line);
            if (msg.method === 'initialize' && msg.id) {
              const response = {
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                  protocolVersion: 'test',
                  capabilities: {},
                  serverInfo: { name: 'test-server', version: '1.0.0' }
                }
              };
              process.stdout.write(JSON.stringify(response) + '\\n');
            }
          } catch (e) {}
        });
      });

      // Keep the process running
      setInterval(() => {}, 1000);
    `;

    fs.writeFileSync(serverFile, serverCode);
  });

  afterEach(async () => {
    if (proxy) {
      try {
        await proxy.stop();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should not send duplicate initialize responses', async () => {
    // Arrange
    const responses: string[] = [];
    let responseCount = 0;

    mockStdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter((line: string) => line.trim());
      lines.forEach((line: string) => {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            responseCount++;
            responses.push(line);
          }
        } catch (e) {}
      });
    });

    const config = {
      serverCommand: 'node',
      serverArgs: [serverFile],
      buildCommand: 'echo "No build needed"',
      watchPattern: [],
      cwd: testDir,
      onExit: exitHandler
    };

    proxy = new MCPHotReload(config, mockStdin, mockStdout, mockStderr);

    // Act
    await proxy.start();

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 500));

    // Send initialize request
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '1.0.0',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    }) + '\n';

    mockStdin.write(initRequest);

    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Assert
    expect(responseCount).toBe(1);
    expect(responses).toHaveLength(1);
  });

  it('should not restart server immediately after initialize', async () => {
    // Arrange
    const restartCount = { count: 0 };

    const config = {
      serverCommand: 'node',
      serverArgs: [serverFile],
      buildCommand: 'echo "No build needed"',
      watchPattern: [],
      cwd: testDir,
      onExit: exitHandler
    };

    proxy = new MCPHotReload(config, mockStdin, mockStdout, mockStderr);

    // Spy on restartServer method
    const originalRestart = (proxy as any).restartServer.bind(proxy);
    (proxy as any).restartServer = async function() {
      restartCount.count++;
      return originalRestart();
    };

    // Act
    await proxy.start();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Send initialize request
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {}
    }) + '\n';

    mockStdin.write(initRequest);

    // Wait to see if restart happens
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Assert - server should not have restarted
    expect(restartCount.count).toBe(0);
  });

  it('should handle server crash without duplicating responses', async () => {
    // Arrange
    const responses: string[] = [];

    mockStdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter((line: string) => line.trim());
      lines.forEach((line: string) => {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            responses.push(line);
          }
        } catch (e) {}
      });
    });

    // Create a server that crashes after responding
    const crashingServerCode = `
      process.stdin.once('data', (data) => {
        const msg = JSON.parse(data.toString().trim());
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { protocolVersion: 'test', capabilities: {} }
          }) + '\\n');
          // Crash after responding
          setTimeout(() => process.exit(1), 100);
        }
      });
    `;

    const crashingServer = path.join(testDir, 'crashing-server.js');
    fs.writeFileSync(crashingServer, crashingServerCode);

    const config = {
      serverCommand: 'node',
      serverArgs: [crashingServer],
      buildCommand: 'echo "No build needed"',
      watchPattern: [],
      cwd: testDir,
      onExit: exitHandler
    };

    proxy = new MCPHotReload(config, mockStdin, mockStdout, mockStderr);

    // Act
    await proxy.start();
    await new Promise(resolve => setTimeout(resolve, 500));

    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {}
    }) + '\n';

    mockStdin.write(initRequest);

    // Wait for crash and potential restart
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Assert - should only have one response even if server crashed
    expect(responses).toHaveLength(1);
  });
});