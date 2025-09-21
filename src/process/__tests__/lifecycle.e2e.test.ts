import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { exec } from 'child_process';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { cleanupProxyProcess, cleanupTestDirectory } from '../../__tests__/utils/process-cleanup.js';
import fixtures from '../../__tests__/fixtures/test-fixtures.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getAllChildProcesses(parentPid: number): Promise<number[]> {
  try {
    // Use pgrep to find all processes with this parent
    const { stdout } = await execAsync(`pgrep -P ${parentPid}`);
    return stdout.trim().split('\n').filter(p => p).map(p => parseInt(p, 10));
  } catch {
    return []; // No child processes found
  }
}

async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    await execAsync(`ps -p ${pid}`);
    return true;
  } catch {
    return false;
  }
}

async function getProcessTree(rootPid: number): Promise<number[]> {
  const allPids = new Set<number>([rootPid]);
  const toCheck = [rootPid];

  while (toCheck.length > 0) {
    const pid = toCheck.shift()!;
    const children = await getAllChildProcesses(pid);
    for (const child of children) {
      if (!allPids.has(child)) {
        allPids.add(child);
        toCheck.push(child);
      }
    }
  }

  return Array.from(allPids);
}

describe.sequential('MCP Server Lifecycle E2E', () => {
  let testDir: string | null = null;
  let currentProxyProcess: ChildProcess | null = null;

  afterEach(async () => {
    // Ensure any spawned proxy process is cleaned up
    if (currentProxyProcess && !currentProxyProcess.killed) {
      await cleanupProxyProcess(currentProxyProcess);
    }
    currentProxyProcess = null;

    // Clean up test directory if it exists
    cleanupTestDirectory(testDir);
    testDir = null;
  });

  it('should kill all child processes when proxy receives SIGINT', async () => {
    // Arrange
    const proxyPath = fixtures.PROXY_PATH;
    const testServerPath = fixtures.TEST_SERVERS.SIGNAL_TEST;

    // Start proxy with signal-test-server that spawns child processes
    const proxyProcess = spawn('node', [proxyPath, 'node', testServerPath], {
      cwd: fixtures.PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LOG_LEVEL: 'debug', SPAWN_CHILD: 'true' }
    });
    currentProxyProcess = proxyProcess;

    const proxyPid = proxyProcess.pid!;
    console.error(`Started proxy with PID: ${proxyPid}`);

    // Collect stderr for debugging
    let stderrData = '';
    proxyProcess.stderr!.on('data', (data) => {
      stderrData += data.toString();
    });

    // Send MCP initialize request to start the server
    const initRequest = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '1.0.0',
        capabilities: {}
      },
      id: 1
    };

    proxyProcess.stdin!.write(JSON.stringify(initRequest) + '\n');

    // Wait for server to start and potentially spawn children
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get process tree before killing
    const processTreeBefore = await getProcessTree(proxyPid);
    console.error(`Process tree before SIGINT: ${processTreeBefore.join(', ')}`);
    expect(processTreeBefore.length).toBeGreaterThanOrEqual(1);

    // Act - Send SIGINT
    proxyProcess.kill('SIGINT');

    // Wait for proxy to exit
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error(`Process did not exit. stderr: ${stderrData}`);
        reject(new Error(`Proxy ${proxyPid} did not exit`));
      }, 3000);

      proxyProcess.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    // Wait a bit more to ensure cleanup completes
    await new Promise(resolve => setTimeout(resolve, 500));

    // Assert - Check all processes are dead
    for (const pid of processTreeBefore) {
      const isRunning = await isProcessRunning(pid);
      if (isRunning) {
        console.error(`Process ${pid} is still running after SIGINT`);
        // Try to get more info about the process
        try {
          const { stdout } = await execAsync(`ps -p ${pid} -o pid,ppid,command`);
          console.error(`Process details: ${stdout}`);
        } catch {
          // Process might have died between checks
        }
      }
      expect(isRunning).toBe(false);
    }
  });

  it('should kill all processes when proxy stdin closes', async () => {
    // Arrange - Use existing test fixture
    testDir = path.join(fixtures.PROJECT_ROOT, `test-cleanup-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Use the stdin-test-server fixture which handles stdin properly
    const testServerPath = fixtures.TEST_SERVERS.STDIN_TEST;
    const config = {
      serverCommand: 'node',
      serverArgs: [testServerPath],
      buildCommand: '',
      watchPattern: [],
      debounceMs: 100
    };
    writeFileSync(path.join(testDir, 'hot-reload.config.json'), JSON.stringify(config, null, 2));

    const proxyPath = fixtures.PROXY_PATH;
    const proxyProcess = spawn('node', [proxyPath], {
      cwd: testDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LOG_LEVEL: 'debug' }
    });
    currentProxyProcess = proxyProcess;

    const proxyPid = proxyProcess.pid!;
    console.error(`Started proxy with PID: ${proxyPid}`);

    // Wait for server to start and capture stderr output
    let serverStarted = false;
    proxyProcess.stderr!.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Healthy') || output.includes('Process ready')) {
        serverStarted = true;
      }
    });

    // Send MCP initialize request to start communication
    const initRequest = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '1.0.0',
        capabilities: {}
      },
      id: 1
    };

    proxyProcess.stdin!.write(JSON.stringify(initRequest) + '\n');

    // Wait for server to be healthy
    let attempts = 0;
    while (!serverStarted && attempts < 30) {  // 3 seconds max
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    if (!serverStarted) {
      console.error('Server did not report healthy status');
    }

    // Get process tree
    const processTreeBefore = await getProcessTree(proxyPid);
    console.error(`Process tree before stdin close: ${processTreeBefore.join(', ')}`);

    // Act - Close stdin
    proxyProcess.stdin!.end();

    // Wait for exit
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Proxy ${proxyPid} did not exit after stdin close`));
      }, 3000);

      proxyProcess.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 500));

    // Assert - All processes should be dead
    for (const pid of processTreeBefore) {
      const isRunning = await isProcessRunning(pid);
      if (isRunning) {
        // Log which process is still running for debugging
        try {
          const { stdout } = await execAsync(`ps -p ${pid} -o pid,ppid,command`);
          console.error(`Process ${pid} still running after stdin close: ${stdout}`);
        } catch {
          // Process died between checks
        }
      }
      expect(isRunning).toBe(false);
    }

  });

  it('should handle rapid SIGINT signals gracefully', async () => {
    // Arrange
    const proxyPath = fixtures.PROXY_PATH;

    const proxyProcess = spawn('node', [proxyPath], {
      cwd: fixtures.PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LOG_LEVEL: 'debug' }
    });
    currentProxyProcess = proxyProcess;

    const proxyPid = proxyProcess.pid!;

    // Wait for startup
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Act - Send multiple SIGINT signals rapidly
    proxyProcess.kill('SIGINT');
    proxyProcess.kill('SIGINT');
    proxyProcess.kill('SIGINT');

    // Assert - Should exit cleanly without hanging
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Process hung after multiple SIGINTs'));
      }, 2000);

      proxyProcess.on('exit', (code) => {
        clearTimeout(timeout);
        expect(code).toBe(0);
        resolve();
      });
    });

    // Verify it's really dead
    const isRunning = await isProcessRunning(proxyPid);
    expect(isRunning).toBe(false);
  });

  it('should track process references correctly through multiple restarts', { timeout: 20000 }, async () => {
    // Arrange
    const testDir = path.join(fixtures.PROJECT_ROOT, 'test-multi-restart-' + Date.now());
    mkdirSync(testDir, { recursive: true });
    mkdirSync(path.join(testDir, 'src'), { recursive: true });

    let version = 1;

    const writeServerWithVersion = (v: number) => {
      const serverCode = `#!/usr/bin/env node
const version = ${v};
process.stderr.write(\`Server v\${version} PID: \${process.pid}\\n\`);
process.stdin.on('data', (data) => {
  const messages = data.toString().split('\\n').filter(line => line.trim());
  messages.forEach(line => {
    try {
      const msg = JSON.parse(line);
      if (msg.method === 'initialize' && msg.id) {
        const response = {
          jsonrpc: '2.0',
          id: msg.id,
          result: { protocolVersion: 'test', capabilities: {} }
        };
        process.stdout.write(JSON.stringify(response) + '\\n');
      }
    } catch (e) {}
  });
});
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
setInterval(() => {}, 1000).unref();`;
      writeFileSync(path.join(testDir, 'server.js'), serverCode);
    };

    writeServerWithVersion(version);

    const config = {
      mcpServerCommand: 'node',
      mcpServerArgs: ['server.js'],
      buildCommand: 'true',
      watchPattern: ['./src/**/*.js'],
      debounceMs: 100
    };
    writeFileSync(path.join(testDir, 'hot-reload.config.json'), JSON.stringify(config));

    // Start proxy
    const proxyPath = fixtures.PROXY_PATH;
    const proxyProcess = spawn('node', [proxyPath], {
      cwd: testDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LOG_LEVEL: 'debug', SPAWN_CHILD: 'true' }
    });
    currentProxyProcess = proxyProcess;

    const processHistory: Array<{ version: number, pid: number }> = [];

    proxyProcess.stderr!.on('data', (data) => {
      const output = data.toString();
      const matches = output.matchAll(/Server v(\d+) PID: (\d+)/g);
      for (const match of matches) {
        const v = parseInt(match[1], 10);
        const pid = parseInt(match[2], 10);
        processHistory.push({ version: v, pid });
      }
    });

    const keepAliveInterval = setInterval(() => {
      if (proxyProcess && !proxyProcess.killed && proxyProcess.stdin) {
        proxyProcess.stdin.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'ping',
          id: Math.random()
        }) + '\n');
      }
    }, 1000);

    // Initialize
    proxyProcess.stdin!.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '1.0.0', capabilities: {} },
      id: 1
    }) + '\n');

    // Wait for initial version
    const waitForVersion = async (targetVersion: number, timeoutMs = 5000) => {
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        const hasVersion = processHistory.some(p => p.version === targetVersion);
        if (hasVersion) {
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return false;
    };

    expect(await waitForVersion(1)).toBe(true);

    // Wait for file watcher to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Perform multiple restarts
    for (let i = 0; i < 3; i++) {
      const previousVersion = version;
      version++;

      // Update server with new version
      writeServerWithVersion(version);

      // Create a NEW file to trigger restart
      const newTriggerFile = path.join(testDir, 'src', `trigger-${i}.js`);
      writeFileSync(newTriggerFile, `// Trigger restart ${i + 1}`);

      await new Promise(resolve => setTimeout(resolve, 2000));
      expect(await waitForVersion(version)).toBe(true);
    }

    // Assert - We should have 4 different processes
    expect(processHistory.length).toBe(4);

    // All PIDs should be unique
    const pids = processHistory.map(p => p.pid);
    const uniquePids = new Set(pids);
    expect(uniquePids.size).toBe(4);

    // Verify only the latest is running
    for (let i = 0; i < processHistory.length; i++) {
      const { pid, version } = processHistory[i];
      const isRunning = await isProcessRunning(pid);

      if (i === processHistory.length - 1) {
        expect(isRunning).toBe(true);
      } else {
        expect(isRunning).toBe(false);
      }
    }

    // Cleanup
    clearInterval(keepAliveInterval);
    proxyProcess.kill('SIGINT');

    await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(undefined), 2000);
      proxyProcess!.on('exit', () => {
        clearTimeout(timeout);
        resolve(undefined);
      });
    });

    // Cleanup test directory
    rmSync(testDir, { recursive: true, force: true });
  });
});