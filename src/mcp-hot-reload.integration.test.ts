import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MCPHotReload } from './mcp-hot-reload.js';
import { PassThrough } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import chokidar from 'chokidar';

// Use process.cwd() to find the test server since we're in Jest environment
const TEST_SERVER_PATH = path.join(process.cwd(), 'test/fixtures/servers/all-content-types-server.js');

describe('MCPHotReload Integration Tests', () => {
  const testDir = path.join(process.cwd(), 'test-server-tmp');
  let proxy: MCPHotReload | null = null;

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

      const proxy = new MCPHotReload({
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
          const lines = chunk.split('\n').filter(line => line.trim());
          return lines.map(line => {
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

      proxy = new MCPHotReload({
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

      // Assert - Check actual behavior through metrics
      const metrics = proxy.getMetrics();
      expect(metrics.fileChangesDetected).toBeGreaterThan(0);
      expect(metrics.restartCount).toBeGreaterThan(0);
      expect(metrics.buildCount).toBeGreaterThanOrEqual(2); // Initial + restart

      // Also verify we got more outputs
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
        interval: 100
      });

      let eventCount = 0;
      watcher.on('all', () => {
        eventCount++;
      });

      await new Promise<void>(resolve => watcher.once('ready', () => resolve()));

      // Create a file
      const testFile = path.join(watchDir, 'test.txt');
      fs.writeFileSync(testFile, 'content');

      // Wait longer for polling (Jest might be interfering with timers)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Modify the file
      fs.writeFileSync(testFile, 'modified');

      // Wait even longer
      await new Promise(resolve => setTimeout(resolve, 3000));

      await watcher.close();
      expect(eventCount).toBeGreaterThan(0);
    }, 10000);

    it('should support glob patterns for file watching', async () => {
      // Arrange
      const serverPath = path.join(testDir, 'server.js');
      fs.copyFileSync(TEST_SERVER_PATH, serverPath);
      fs.chmodSync(serverPath, 0o755);
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(testDir, 'lib'), { recursive: true });

      proxy = new MCPHotReload({
        serverCommand: 'node',
        serverArgs: ['server.js'],
        cwd: testDir,
        watchPattern: ['./src/**/*.py', './lib/**/*.js'],
        debounceMs: 100,
        onExit: () => {}
      }, new PassThrough(), new PassThrough(), new PassThrough());

      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Act & Assert
      const initialMetrics = proxy.getMetrics();

      // TypeScript files should NOT trigger (not in pattern)
      fs.writeFileSync(path.join(testDir, 'src/index.ts'), 'console.log("ts")');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const afterTSMetrics = proxy.getMetrics();
      expect(afterTSMetrics.fileChangesDetected).toBe(initialMetrics.fileChangesDetected);

      // Python files in src SHOULD trigger
      fs.writeFileSync(path.join(testDir, 'src/main.py'), 'print("hello")');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const afterPyMetrics = proxy.getMetrics();
      expect(afterPyMetrics.fileChangesDetected).toBeGreaterThan(afterTSMetrics.fileChangesDetected);

      // JavaScript files in lib SHOULD trigger
      fs.writeFileSync(path.join(testDir, 'lib/utils.js'), 'module.exports = {}');
      await new Promise(resolve => setTimeout(resolve, 1500));

      const finalMetrics = proxy.getMetrics();
      expect(finalMetrics.fileChangesDetected).toBeGreaterThan(afterPyMetrics.fileChangesDetected);
      expect(finalMetrics.restartCount).toBeGreaterThan(initialMetrics.restartCount);
    }, 10000);

    it('should only restart for TypeScript files, not other file types', async () => {
      // Arrange
      const serverPath = path.join(testDir, 'server.js');
      fs.copyFileSync(TEST_SERVER_PATH, serverPath);
      fs.chmodSync(serverPath, 0o755);
      fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });

      proxy = new MCPHotReload({
        serverCommand: 'node',
        serverArgs: ['server.js'],
        cwd: testDir,
        watchPattern: 'src',
        debounceMs: 100,
        onExit: () => {}
      }, new PassThrough(), new PassThrough(), new PassThrough());

      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 500));

      // Act & Assert
      const initialMetrics = proxy.getMetrics();

      // Non-TypeScript files should NOT trigger restarts
      fs.writeFileSync(path.join(testDir, 'src/readme.md'), '# README');
      fs.writeFileSync(path.join(testDir, 'src/config.json'), '{}');
      fs.writeFileSync(path.join(testDir, 'src/styles.css'), 'body {}');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const afterNonTSMetrics = proxy.getMetrics();
      expect(afterNonTSMetrics.fileChangesDetected).toBe(initialMetrics.fileChangesDetected);
      expect(afterNonTSMetrics.restartCount).toBe(initialMetrics.restartCount);

      // TypeScript files SHOULD trigger restarts
      fs.writeFileSync(path.join(testDir, 'src/index.ts'), 'console.log("test")');
      fs.writeFileSync(path.join(testDir, 'src/types.tsx'), 'export {}');
      await new Promise(resolve => setTimeout(resolve, 1500));

      const finalMetrics = proxy.getMetrics();
      expect(finalMetrics.fileChangesDetected).toBeGreaterThan(afterNonTSMetrics.fileChangesDetected);
      expect(finalMetrics.restartCount).toBeGreaterThan(afterNonTSMetrics.restartCount);
    }, 10000);
  });

  describe('Error Handling', () => {
    it('should handle build failures gracefully', async () => {
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

      proxy = new MCPHotReload({
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

      // Assert - Check behavior through metrics
      const metrics = proxy.getMetrics();
      expect(metrics.buildCount).toBeGreaterThan(0);
      expect(metrics.buildFailureCount).toBeGreaterThan(0); // Build failed
      expect(metrics.buildSuccessCount).toBe(0); // No successful builds

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

      proxy = new MCPHotReload({
        buildCommand: 'echo "Building"',
        serverCommand: 'node',
        serverArgs: ['-e', 'process.exit(1)'], // Crashes immediately
        cwd: testDir,
        onExit: () => {}
      }, clientIn, clientOut, clientErr);

      // Act
      await proxy.start();
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Assert - Server process should have exited
      // The proxy's serverProcess should be null after crash
      await new Promise(resolve => setTimeout(resolve, 500));
      expect((proxy as any).serverProcess).toBeNull();
    }, 10000);
  });
});