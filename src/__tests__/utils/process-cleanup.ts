import { ChildProcess, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Get direct child process PIDs of a given PID (not recursive)
 * We only clean up direct children to avoid killing shared services like esbuild
 */
async function getDirectChildPids(parentPid: number): Promise<number[]> {
  try {
    // Use pgrep to find only direct children (not recursive)
    const { stdout } = await execAsync(`pgrep -P ${parentPid}`);
    const childPids = stdout.trim().split('\n').filter(Boolean).map(Number);
    return childPids;
  } catch {
    // No children found or pgrep failed
    return [];
  }
}

/**
 * Properly closes a proxy process and detects memory leaks.
 * The proxy should exit when stdin is closed per MCP protocol.
 * If it doesn't exit, that indicates a memory leak.
 * Also cleans up any orphaned child processes.
 *
 * @returns true if process exited cleanly, false if force-kill was needed (potential memory leak)
 */
export async function cleanupProxyProcess(proxy: ChildProcess | null): Promise<boolean> {
  if (!proxy || proxy.killed) {
    return true;  // Already cleaned up
  }

  const pid = proxy.pid;
  console.error(`[CLEANUP] Starting cleanup for process PID: ${pid}`);

  // First, get direct child processes before we kill the parent
  const childPids = pid ? await getDirectChildPids(pid) : [];
  if (childPids.length > 0) {
    console.error(`[CLEANUP] Found ${childPids.length} child processes: ${childPids.join(', ')}`);
  }

  // Close stdin - this SHOULD cause the proxy to exit per MCP protocol
  console.error(`[CLEANUP] Closing stdin for PID: ${pid}`);
  proxy.stdin?.end();

  // Wait for graceful exit (1000ms timeout)
  const exitPromise = new Promise<'exited' | 'timeout'>((resolve) => {
    proxy.once('exit', (code, signal) => {
      console.error(`[CLEANUP] Process PID ${pid} exited gracefully with code: ${code}, signal: ${signal}`);
      resolve('exited');
    });
    setTimeout(() => {
      console.error(`[CLEANUP] Timeout waiting for PID ${pid} to exit gracefully`);
      resolve('timeout');
    }, 1000);
  });

  console.error(`[CLEANUP] Waiting for process PID ${pid} to exit...`);
  const result = await exitPromise;

  // Check for memory leak
  if (result === 'timeout' && !proxy.killed) {
    const pid = proxy.pid;

    // Log potential memory leak for debugging
    console.error(`⚠️  MEMORY LEAK DETECTED: Proxy PID ${pid} did not exit after stdin closed!`);
    console.error('This may indicate:');
    console.error('  1. Server failed to start (check test directory has required files)');
    console.error('  2. Memory leak in proxy (stdin "end" handler not working)');
    console.error('Forcing kill to clean up test environment...');

    // Try SIGTERM first, then SIGKILL
    console.error(`[CLEANUP] Sending SIGTERM to PID ${pid}...`);
    proxy.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 100));

    if (!proxy.killed) {
      console.error(`[CLEANUP] Process ${pid} still alive, sending SIGKILL...`);
      proxy.kill('SIGKILL');
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Also try to kill by PID if still not dead
    if (pid && !proxy.killed) {
      try {
        console.error(`[CLEANUP] Process ${pid} STILL alive, using process.kill(SIGKILL)...`);
        process.kill(pid, 'SIGKILL');
      } catch (e) {
        console.error(`[CLEANUP] Error killing process ${pid}: ${e}`);
      }
    }

    // Cleanup child processes after killing parent
    await cleanupChildProcesses(childPids);

    // Return false to indicate force-kill was needed
    return false;
  }

  // Process exited cleanly
  console.error(`[CLEANUP] Process PID ${pid} exited cleanly ✓`);

  // Still need to clean up any orphaned child processes
  // (proxy exits immediately per MCP protocol, leaving children orphaned)
  await cleanupChildProcesses(childPids);

  return true;
}

/**
 * Kill all child processes
 */
async function cleanupChildProcesses(pids: number[]): Promise<void> {
  if (pids.length === 0) return;

  console.error(`[CLEANUP] Killing ${pids.length} orphaned child processes...`);

  for (const childPid of pids) {
    try {
      process.kill(childPid, 'SIGKILL');
      console.error(`[CLEANUP] Killed orphaned child PID: ${childPid}`);
    } catch (e) {
      // Process already dead or no permission, ignore
      console.error(`[CLEANUP] Could not kill PID ${childPid}: ${e}`);
    }
  }
}

/**
 * Cleanup helper for test directories
 */
export function cleanupTestDirectory(testDir: string | null): void {
  if (testDir && require('fs').existsSync(testDir)) {
    require('fs').rmSync(testDir, { recursive: true, force: true });
  }
}