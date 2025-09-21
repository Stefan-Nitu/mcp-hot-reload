import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { writeFileSync } from 'fs';
import { cleanupProxyProcess } from '../../__tests__/utils/process-cleanup.js';
import fixtures from '../../__tests__/fixtures/test-fixtures.js';

describe.sequential('Message Router Restart E2E', () => {
  let proxyProcess: ChildProcess | null = null;
  const testFilePath = fixtures.TEST_FILES.TEST_FILE_TS;
  const originalContent = '// Original content\nexport const value = 1;';
  const modifiedContent = '// Modified content\nexport const value = 2;';

  beforeEach(() => {
    // Create test file with original content
    writeFileSync(testFilePath, originalContent);
  });

  afterEach(async () => {
    // Clean up process
    await cleanupProxyProcess(proxyProcess);
    proxyProcess = null;

    // Restore original content
    writeFileSync(testFilePath, originalContent);
  });

  it('should not create duplicate connections after hot-reload restart', async () => {
    // Arrange
    const proxyPath = fixtures.PROXY_PATH;
    const testServerPath = fixtures.TEST_SERVERS.SIMPLE_ECHO;

    // Start proxy with a test configuration
    proxyProcess = spawn('node', [proxyPath, 'node', testServerPath, '--watch', testFilePath], {
      cwd: fixtures.PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LOG_LEVEL: 'debug'
      }
    });

    // Collect stderr to check for duplicate messages
    const stderrChunks: string[] = [];
    proxyProcess.stderr!.on('data', (data) => {
      stderrChunks.push(data.toString());
    });

    // Send initialize request
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '1.0.0',
        capabilities: {}
      },
      id: 1
    }) + '\n';

    proxyProcess.stdin!.write(initRequest);

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Clear stderr to only capture restart logs
    stderrChunks.length = 0;

    // Act - Trigger hot-reload by modifying file
    writeFileSync(testFilePath, modifiedContent);

    // Wait for hot-reload to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Assert - Check for duplicate "connectServer called" messages
    const fullStderr = stderrChunks.join('');
    const connectServerMatches = fullStderr.match(/connectServer called/g) || [];

    console.error(`Found ${connectServerMatches.length} "connectServer called" messages`);

    // After a single restart, there should only be ONE connectServer call
    expect(connectServerMatches.length).toBe(1);

    // Also check for duplicate "Adding server data listener" messages
    const listenerMatches = fullStderr.match(/Adding server data listener/g) || [];

    console.error(`Found ${listenerMatches.length} "Adding server data listener" messages`);

    expect(listenerMatches.length).toBe(1);

    // Send SIGINT to exit cleanly
    proxyProcess.kill('SIGINT');

    // Wait for exit
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Process did not exit'));
      }, 2000);

      proxyProcess!.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  });

  it('should track connectServer calls during normal operation vs restart', async () => {
    // Arrange
    const proxyPath = fixtures.PROXY_PATH;
    const testServerPath = fixtures.TEST_SERVERS.SIMPLE_ECHO;

    proxyProcess = spawn('node', [proxyPath, 'node', testServerPath, '--watch', testFilePath], {
      cwd: fixtures.PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LOG_LEVEL: 'debug' }
    });

    let connectServerCount = 0;
    let phase = 'initial';

    proxyProcess.stderr!.on('data', (data) => {
      const output = data.toString();

      // Count connectServer calls
      const matches = output.match(/connectServer called/g);
      if (matches) {
        connectServerCount += matches.length;
        console.error(`[${phase}] connectServer called (total: ${connectServerCount})`);
      }

      // Track phase changes
      if (output.includes('Build succeeded, restarting server')) {
        phase = 'restarting';
      } else if (output.includes('Server stopped') && phase === 'restarting') {
        phase = 'restarted';
      }
    });

    // Send initialize
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '1.0.0', capabilities: {} },
      id: 1
    }) + '\n';

    proxyProcess.stdin!.write(initRequest);

    // Wait for initial startup
    await new Promise(resolve => setTimeout(resolve, 2000));

    const initialConnectCount = connectServerCount;
    console.error(`Initial connectServer count: ${initialConnectCount}`);

    // Trigger restart by modifying file
    writeFileSync(testFilePath, modifiedContent);

    // Wait for restart
    await new Promise(resolve => setTimeout(resolve, 3000));

    const afterRestartCount = connectServerCount - initialConnectCount;
    console.error(`connectServer calls after restart: ${afterRestartCount}`);

    // Assert
    // Initial startup should have 1 connectServer call
    expect(initialConnectCount).toBe(1);

    // After restart, should have exactly 1 more (not 2)
    expect(afterRestartCount).toBe(1);

    // Clean up
    proxyProcess.kill('SIGINT');
  });
});