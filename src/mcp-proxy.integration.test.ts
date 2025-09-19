import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MCPProxy } from './mcp-proxy.js';
import { PassThrough } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import chokidar from 'chokidar';

// Use process.cwd() to find the test server since we're in Jest environment
const TEST_SERVER_PATH = path.join(process.cwd(), 'test/fixtures/servers/all-content-types-server.js');

describe('MCPProxy Integration Tests', () => {
  const testDir = path.join(process.cwd(), 'test-server-tmp');
  let proxy: MCPProxy | null = null;

  beforeEach(() => {
    // Create test server directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(async () => {
    // Cleanup
    if (proxy) {
      await proxy.stop();
      proxy = null;
    }
    // Clean up environment variables that might affect subsequent tests
    delete process.env.MCP_PROXY_INSTANCE;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('MCP Content Types', () => {
    // Helper function to setup test environment with the comprehensive server
    const setupTestEnvironment = async () => {
      // Copy test server to test directory
      const serverPath = path.join(testDir, 'server.js');
      fs.copyFileSync(TEST_SERVER_PATH, serverPath);
      fs.chmodSync(serverPath, 0o755);

      // Create src directory for watching
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'src/dummy.ts'), '// dummy file for watching');

      const clientIn = new PassThrough();
      const clientOut = new PassThrough();
      const clientErr = new PassThrough();
      const capturedOutput: string[] = [];
      const capturedErrors: string[] = [];

      clientOut.on('data', (chunk) => capturedOutput.push(chunk.toString()));
      clientErr.on('data', (chunk) => capturedErrors.push(chunk.toString()));

      const proxy = new MCPProxy({
        buildCommand: 'echo "Building"',
        serverCommand: 'node',
        serverArgs: ['server.js'],
        cwd: testDir,
        watchPattern: path.join(testDir, 'src'),
        debounceMs: 100,
        onExit: () => {}
      }, clientIn, clientOut, clientErr);

      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Initialize the connection
      clientIn.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' }
      }) + '\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      return { proxy, clientIn, clientOut, capturedOutput, capturedErrors };
    };

    const parseResponses = (capturedOutput: string[]) => {
      return capturedOutput
        .map(chunk => {
          const lines = chunk.split('\n').filter((line: string) => line.trim());
          return lines.map((line: string) => {
            try { return JSON.parse(line); } catch { return null; }
          });
        })
        .flat()
        .filter(Boolean);
    };

    it('should handle text content type', async () => {
      // Arrange
      const { proxy: testProxy, clientIn, capturedOutput } = await setupTestEnvironment();
      proxy = testProxy;

      // Act
      clientIn.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'getText', arguments: { message: 'Custom text message' } }
      }) + '\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const responses = parseResponses(capturedOutput);
      const textResponse = responses.find(r => r.id === 2);
      expect(textResponse).toBeDefined();
      expect(textResponse?.result?.content).toHaveLength(1);
      expect(textResponse?.result?.content[0].type).toBe('text');
      expect(textResponse?.result?.content[0].text).toBe('Custom text message');
    });

    it('should handle image content type', async () => {
      // Arrange
      const { proxy: testProxy, clientIn, capturedOutput } = await setupTestEnvironment();
      proxy = testProxy;

      // Act
      clientIn.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'getImage' }
      }) + '\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const responses = parseResponses(capturedOutput);
      const imageResponse = responses.find(r => r.id === 2);
      expect(imageResponse).toBeDefined();
      expect(imageResponse?.result?.content).toHaveLength(1);
      expect(imageResponse?.result?.content[0].type).toBe('image');
      expect(imageResponse?.result?.content[0].mimeType).toBe('image/png');
      expect(imageResponse?.result?.content[0].data).toBeTruthy();
    });

    it('should handle resource_link content type', async () => {
      // Arrange
      const { proxy: testProxy, clientIn, capturedOutput } = await setupTestEnvironment();
      proxy = testProxy;

      // Act
      clientIn.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'getResourceLinks' }
      }) + '\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const responses = parseResponses(capturedOutput);
      const linksResponse = responses.find(r => r.id === 2);
      expect(linksResponse).toBeDefined();
      expect(linksResponse?.result?.content).toHaveLength(4); // 1 text + 3 links

      const textContent = linksResponse?.result?.content[0];
      expect(textContent.type).toBe('text');
      expect(textContent.text).toContain('Found 3 files');

      const link1 = linksResponse?.result?.content[1];
      expect(link1.type).toBe('resource_link');
      expect(link1.uri).toBe('file:///project/README.md');
      expect(link1.name).toBe('README.md');
      expect(link1.mimeType).toBe('text/markdown');
    });

    it('should handle embedded resource content type', async () => {
      // Arrange
      const { proxy: testProxy, clientIn, capturedOutput } = await setupTestEnvironment();
      proxy = testProxy;

      // Act
      clientIn.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'getEmbeddedResource' }
      }) + '\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const responses = parseResponses(capturedOutput);
      const resourceResponse = responses.find(r => r.id === 2);
      expect(resourceResponse).toBeDefined();
      expect(resourceResponse?.result?.content).toHaveLength(1);

      const resourceContent = resourceResponse?.result?.content[0];
      expect(resourceContent.type).toBe('resource');
      expect(resourceContent.resource).toBeDefined();
      expect(resourceContent.resource.uri).toBe('file:///project/config.json');
      expect(resourceContent.resource.title).toBe('Configuration File');
      expect(resourceContent.resource.mimeType).toBe('application/json');
      expect(resourceContent.resource.text).toContain('"debug": true');
    });

    it('should handle structuredContent (JSON) response', async () => {
      // Arrange
      const { proxy: testProxy, clientIn, capturedOutput } = await setupTestEnvironment();
      proxy = testProxy;

      // Act
      clientIn.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'getStructuredData' }
      }) + '\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const responses = parseResponses(capturedOutput);
      const weatherResponse = responses.find(r => r.id === 2);
      expect(weatherResponse).toBeDefined();
      expect(weatherResponse?.result?.content).toHaveLength(1);

      // Text content for backward compatibility
      const textContent = weatherResponse?.result?.content[0];
      expect(textContent.type).toBe('text');
      expect(textContent.text).toContain('temperature');

      // Structured content
      expect(weatherResponse?.result?.structuredContent).toBeDefined();
      expect(weatherResponse?.result?.structuredContent.temperature).toBe(22.5);
      expect(weatherResponse?.result?.structuredContent.humidity).toBe(65);
      expect(weatherResponse?.result?.structuredContent.conditions).toBe('Partly cloudy');
      expect(weatherResponse?.result?.structuredContent.wind).toEqual({ speed: 10, direction: 'NW' });
      expect(weatherResponse?.result?.structuredContent.forecast).toHaveLength(2);
    });

    it('should handle mixed content types in single response', async () => {
      // Arrange
      const { proxy: testProxy, clientIn, capturedOutput } = await setupTestEnvironment();
      proxy = testProxy;

      // Act
      clientIn.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'getMixedContent' }
      }) + '\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const responses = parseResponses(capturedOutput);
      const mixedResponse = responses.find(r => r.id === 2);
      expect(mixedResponse).toBeDefined();
      expect(mixedResponse?.result?.content).toHaveLength(4);

      // Check each content type
      expect(mixedResponse?.result?.content[0].type).toBe('text');
      expect(mixedResponse?.result?.content[1].type).toBe('resource_link');
      expect(mixedResponse?.result?.content[2].type).toBe('image');
      expect(mixedResponse?.result?.content[3].type).toBe('text');

      // Check structured content is also present
      expect(mixedResponse?.result?.structuredContent).toBeDefined();
      expect(mixedResponse?.result?.structuredContent.issues).toBe(3);
      expect(mixedResponse?.result?.structuredContent.warnings).toBe(2);
    });

    it('should list all available tools', async () => {
      // Arrange
      const { proxy: testProxy, clientIn, capturedOutput } = await setupTestEnvironment();
      proxy = testProxy;

      // Act
      clientIn.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      }) + '\n');

      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert
      const responses = parseResponses(capturedOutput);
      const toolsResponse = responses.find(r => r.id === 2);
      expect(toolsResponse).toBeDefined();
      expect(toolsResponse?.result?.tools).toBeDefined();
      expect(toolsResponse?.result?.tools).toHaveLength(7);

      const toolNames = toolsResponse?.result?.tools.map((t: any) => t.name);
      expect(toolNames).toContain('getText');
      expect(toolNames).toContain('getImage');
      expect(toolNames).toContain('getResourceLinks');
      expect(toolNames).toContain('getEmbeddedResource');
      expect(toolNames).toContain('getStructuredData');
      expect(toolNames).toContain('getMixedContent');
      expect(toolNames).toContain('echo');
    });
  });

  describe('Server Restart and File Watching', () => {
    it('should restart server on file changes', async () => {
      // Arrange
      const serverPath = path.join(testDir, 'server.js');
      fs.copyFileSync(TEST_SERVER_PATH, serverPath);
      fs.chmodSync(serverPath, 0o755);

      // Only create the directory, not the file yet
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });

      const clientIn = new PassThrough();
      const clientOut = new PassThrough();
      const clientErr = new PassThrough();

      const outputs: string[] = [];
      clientOut.on('data', (chunk) => outputs.push(chunk.toString()));
      const errors: string[] = [];
      clientErr.on('data', (chunk) => errors.push(chunk.toString()));

      proxy = new MCPProxy({
        buildCommand: 'echo "Building"',
        serverCommand: 'node',
        serverArgs: ['server.js'],
        cwd: testDir,
        watchPattern: 'src',  // Watch the src directory (globs not supported in chokidar v4)
        debounceMs: 100,
        onExit: () => {}
      }, clientIn, clientOut, clientErr);

      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Send initial initialize request
      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      }) + '\n';
      clientIn.write(initRequest);
      await new Promise(resolve => setTimeout(resolve, 500));

      const initialOutputs = outputs.length;

      // Act - create a new file (should trigger 'add' event)
      const watchFile = path.join(testDir, 'src/watch.ts');
      fs.writeFileSync(watchFile, '// initial content');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Now modify it (should trigger 'change' event)
      fs.writeFileSync(watchFile, '// modified content');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for detection

      // Send another request after restart
      clientIn.write(initRequest);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert - Server restarted (we get more outputs)
      expect(outputs.length).toBeGreaterThan(initialOutputs);
    }, 10000);

    it('debug: chokidar should work in Jest', async () => {
      // Direct chokidar test
      const watchDir = path.join(testDir, 'chokidar-test');
      fs.mkdirSync(watchDir, { recursive: true });

      const watcher = chokidar.watch(watchDir, {
        ignoreInitial: true,
        persistent: true,
        usePolling: true,
        interval: 100,
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 100
        }
      });

      const events: string[] = [];
      watcher.on('all', (event) => {
        events.push(event);
      });

      await new Promise<void>(resolve => watcher.once('ready', () => resolve()));

      // Create a file with a delay to ensure it's detected
      const testFile = path.join(watchDir, 'test.txt');
      await new Promise(resolve => setTimeout(resolve, 500));
      fs.writeFileSync(testFile, 'content');

      // Wait for polling to detect the change
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Modify the file
      fs.writeFileSync(testFile, 'modified content');

      // Wait for polling to detect the modification
      await new Promise(resolve => setTimeout(resolve, 2000));

      await watcher.close();

      // Should have detected at least one event (add or change)
      expect(events.length).toBeGreaterThan(0);
    }, 15000);

    it('should support glob patterns for file watching', async () => {
      // Arrange
      const serverPath = path.join(testDir, 'server.js');
      fs.copyFileSync(TEST_SERVER_PATH, serverPath);
      fs.chmodSync(serverPath, 0o755);
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'lib'), { recursive: true });

      const clientIn = new PassThrough();
      const clientOut = new PassThrough();
      const clientErr = new PassThrough();
      const outputs: any[] = [];
      clientOut.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter((line: string) => line.trim());
        lines.forEach((line: string) => {
          try {
            const msg = JSON.parse(line);
            if (msg.id === 1 && msg.result) {
              outputs.push(msg);
            }
          } catch (e) {
            // Ignore non-JSON lines
          }
        });
      });

      proxy = new MCPProxy({
        serverCommand: 'node',
        serverArgs: ['server.js'],
        cwd: testDir,
        watchPattern: ['./src/**/*.py', './lib/**/*.js'],
        debounceMs: 100,
        onExit: () => {}
      }, clientIn, clientOut, clientErr);

      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Send initialize to get a baseline response
      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      }) + '\n';

      clientIn.write(initRequest);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Act & Assert
      const initialOutputs = outputs.length;
      expect(initialOutputs).toBe(1); // Should have one initialize response

      // TypeScript files should NOT trigger (not in pattern)
      fs.writeFileSync(path.join(testDir, 'src/index.ts'), 'console.log("ts")');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should not restart for files outside watched directories
      expect(outputs.length).toBe(1); // Still just one response

      // Python files in src SHOULD trigger
      fs.writeFileSync(path.join(testDir, 'src/main.py'), 'print("hello")');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for restart

      // Should have restarted (auto re-init gives us 2nd response)
      expect(outputs.length).toBe(2);

      // JavaScript files in lib SHOULD trigger
      fs.writeFileSync(path.join(testDir, 'lib/utils.js'), 'module.exports = {}');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for restart

      // Should restart for JS in lib (auto re-init gives us 3rd response)
      expect(outputs.length).toBe(3);

      // Clean up streams before proxy.stop()
      clientIn.end();
    }, 10000);

    it('should only restart for TypeScript files, not other file types', async () => {
      // Arrange
      const serverPath = path.join(testDir, 'server.js');
      fs.copyFileSync(TEST_SERVER_PATH, serverPath);
      fs.chmodSync(serverPath, 0o755);
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });

      const clientIn = new PassThrough();
      const clientOut = new PassThrough();
      const clientErr = new PassThrough();
      const outputs: any[] = [];
      clientOut.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter((line: string) => line.trim());
        lines.forEach((line: string) => {
          try {
            const msg = JSON.parse(line);
            if (msg.id === 1 && msg.result) {
              outputs.push(msg);
            }
          } catch (e) {
            // Ignore non-JSON lines
          }
        });
      });

      proxy = new MCPProxy({
        serverCommand: 'node',
        serverArgs: ['server.js'],
        cwd: testDir,
        watchPattern: 'src',
        debounceMs: 100,
        onExit: () => {}
      }, clientIn, clientOut, clientErr);

      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Send initialize to get a baseline response
      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      }) + '\n';

      clientIn.write(initRequest);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Act & Assert
      const initialOutputs = outputs.length;
      expect(initialOutputs).toBe(1); // Should have one initialize response

      // Non-TypeScript files should NOT trigger restarts
      fs.writeFileSync(path.join(testDir, 'src/readme.md'), '# README');
      fs.writeFileSync(path.join(testDir, 'src/config.json'), '{}');
      fs.writeFileSync(path.join(testDir, 'src/styles.css'), 'body {}');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // No restart for non-TS files
      expect(outputs.length).toBe(1); // Still just one response

      // TypeScript files SHOULD trigger restarts
      fs.writeFileSync(path.join(testDir, 'src/index.ts'), 'console.log("test")');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for restart

      // Should restart for .ts file (auto re-init gives us 2nd response)
      expect(outputs.length).toBe(2);

      // Clean up streams before proxy.stop()
      clientIn.end();
    }, 10000);
  });

  describe('Error Handling', () => {
    it('should continue running after build failures and wait for fixes', async () => {
      // Arrange
      const serverPath = path.join(testDir, 'server.js');
      fs.copyFileSync(TEST_SERVER_PATH, serverPath);
      fs.chmodSync(serverPath, 0o755);

      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(testDir, 'src/watch.ts'), '// initial');

      const clientIn = new PassThrough();
      const clientOut = new PassThrough();
      const clientErr = new PassThrough();

      const outputs: string[] = [];
      clientOut.on('data', (chunk) => outputs.push(chunk.toString()));
      const errors: string[] = [];
      clientErr.on('data', (chunk) => errors.push(chunk.toString()));

      proxy = new MCPProxy({
        buildCommand: 'exit 1', // Always fails
        serverCommand: 'node',
        serverArgs: ['server.js'],
        cwd: testDir,
        watchPattern: path.join(testDir, 'src'),
        debounceMs: 100,
        onExit: () => {}
      }, clientIn, clientOut, clientErr);

      // Act
      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Send initialize request
      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      }) + '\n';
      clientIn.write(initRequest);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Trigger change (build will fail but server continues)
      fs.writeFileSync(path.join(testDir, 'src/watch.ts'), '// changed');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Send another request - server should still respond despite build failure
      clientIn.write(initRequest);
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert - Build should fail but server should still run

      // Server should still be running and processing
      expect(proxy).toBeDefined();
      expect(outputs.length).toBeGreaterThan(0);
    }, 10000);

    it('should handle server crashes', async () => {
      // Arrange
      const clientIn = new PassThrough();
      const clientOut = new PassThrough();
      const clientErr = new PassThrough();

      const errors: string[] = [];
      clientErr.on('data', (chunk) => errors.push(chunk.toString()));

      proxy = new MCPProxy({
        buildCommand: 'echo "Building"',
        serverCommand: 'node',
        serverArgs: ['-e', 'process.exit(1)'], // Crashes immediately
        cwd: testDir,
        onExit: () => {}
      }, clientIn, clientOut, clientErr);

      // Act & Assert - Server should fail to start
      await expect(proxy.start()).rejects.toThrow('Process exited during startup');

      // The serverLifecycle should report server as not running after crash
      expect((proxy as any).serverLifecycle.isRunning()).toBe(false);
    }, 10000);
  });

  describe('Double Response Prevention', () => {
    it('should not send duplicate initialize responses', async () => {
      // Arrange
      const serverPath = path.join(process.cwd(), 'test/fixtures/servers/simple-echo-server.js');

      const responses: string[] = [];
      let responseCount = 0;

      const clientIn = new PassThrough();
      const clientOut = new PassThrough();
      const clientErr = new PassThrough();

      clientOut.on('data', (data) => {
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
        serverArgs: [serverPath],
        buildCommand: 'echo "No build needed"',
        watchPattern: [],
        cwd: testDir,
        onExit: jest.fn()
      };

      proxy = new MCPProxy(config, clientIn, clientOut, clientErr);

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

      clientIn.write(initRequest);

      // Wait for responses
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Assert - should only have one response
      expect(responseCount).toBe(1);
      expect(responses).toHaveLength(1);
    });

    it('should not restart server immediately after initialize', async () => {
      // Arrange
      const restartFile = path.join(testDir, 'restarts.txt');
      const serverPath = path.join(process.cwd(), 'test/fixtures/servers/restart-tracking-server.js');
      process.env.RESTART_FILE = restartFile;

      const clientIn = new PassThrough();
      const clientOut = new PassThrough();
      const clientErr = new PassThrough();

      const config = {
        serverCommand: 'node',
        serverArgs: [serverPath],
        buildCommand: 'echo "No build needed"',
        watchPattern: [],
        cwd: testDir,
        onExit: jest.fn()
      };

      proxy = new MCPProxy(config, clientIn, clientOut, clientErr);

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

      clientIn.write(initRequest);

      // Wait to see if restart happens
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Assert - server should not have restarted
      const restarts = fs.existsSync(restartFile) ? parseInt(fs.readFileSync(restartFile, 'utf-8')) : 0;
      expect(restarts).toBe(1); // Should only have started once

      // Clean up environment variable
      delete process.env.RESTART_FILE;
    });

    it('should handle server crash without duplicating responses', async () => {
      // Arrange
      const responses: string[] = [];

      const clientIn = new PassThrough();
      const clientOut = new PassThrough();
      const clientErr = new PassThrough();

      clientOut.on('data', (data) => {
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

      // Use fixture server that crashes after responding
      const serverPath = path.join(process.cwd(), 'test/fixtures/servers/crash-after-init-server.js');

      const config = {
        serverCommand: 'node',
        serverArgs: [serverPath],
        buildCommand: 'echo "No build needed"',
        watchPattern: [],
        cwd: testDir,
        onExit: jest.fn()
      };

      proxy = new MCPProxy(config, clientIn, clientOut, clientErr);

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

      clientIn.write(initRequest);

      // Wait for crash and potential restart
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Assert - should only have one response
      expect(responses.length).toBe(1);
    });
  });
});