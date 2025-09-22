import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServerLifecycle, type McpServerConfig } from '../lifecycle.js';
import { ProcessReadinessChecker } from '../readiness-checker.js';
import { ProcessTerminator } from '../terminator.js';
import { ProcessSpawner } from '../spawner.js';
import type { ChildProcess } from 'child_process';
import fixtures from '../../__tests__/fixtures/test-fixtures.js';

const TEST_SERVER_PATH = fixtures.TEST_SERVERS.SIMPLE_ECHO;

// Helper function to cleanup lifecycle processes since stop() was removed
async function cleanupLifecycleProcess(lifecycle: McpServerLifecycle): Promise<void> {
  const process = (lifecycle as any).currentProcess as ChildProcess | null;
  if (!process || process.killed) return;

  const pid = process.pid;
  console.error(`[CLEANUP] Terminating lifecycle process PID: ${pid}`);

  // Send SIGTERM first
  process.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 100));

  // Force kill if still running
  if (!process.killed && pid) {
    try {
      process.kill('SIGKILL');
    } catch (e) {
      console.error(`[CLEANUP] Error killing process ${pid}: ${e}`);
    }
  }
}

describe.sequential('McpServerLifecycle Integration', () => {
  let lifecycle: McpServerLifecycle;
  let config: McpServerConfig;

  beforeEach(() => {
    // Arrange - Create real components
    const spawner = new ProcessSpawner();

    // Fast timeouts for testing
    const readinessChecker = new ProcessReadinessChecker({
      checkIntervalMs: 10,
      timeoutMs: 2000,
      settleDelayMs: 10
    });

    const restartTerminator = new ProcessTerminator({
      closeStdin: false,
      gracePeriodMs: 0,
      forcePeriodMs: 1000,
      zombieTimeoutMs: 500,
      throwOnZombie: true
    });

    config = {
      command: 'node',
      args: [TEST_SERVER_PATH]
    };

    lifecycle = new McpServerLifecycle(
      config,
      readinessChecker,
      restartTerminator,
      spawner
    );
  });

  afterEach(async () => {
    // Cleanup - ensure process is terminated
    await cleanupLifecycleProcess(lifecycle);
  });

  describe('real process lifecycle', () => {
    it('should start a real Node.js process', async () => {
      // Act - Start the server
      await lifecycle.start();

      // Assert - Process should be running
      const process = (lifecycle as any).currentProcess;
      expect(process).toBeTruthy();
      expect(process.pid).toBeGreaterThan(0);
      expect(process.killed).toBe(false);
    }, 10000);

    it('should restart a running process', async () => {
      // Arrange - Start the server
      await lifecycle.start();
      const firstPid = (lifecycle as any).currentProcess?.pid;
      expect(firstPid).toBeGreaterThan(0);

      // Act - Restart the server
      await lifecycle.restart();

      // Assert - New process should have different PID
      const secondPid = (lifecycle as any).currentProcess?.pid;
      expect(secondPid).toBeGreaterThan(0);
      expect(secondPid).not.toBe(firstPid);
    }, 10000);

    it('should handle multiple restarts', async () => {
      // Arrange
      const pids: number[] = [];

      // Act - Start and restart multiple times
      await lifecycle.start();
      pids.push((lifecycle as any).currentProcess?.pid);

      for (let i = 0; i < 3; i++) {
        await lifecycle.restart();
        pids.push((lifecycle as any).currentProcess?.pid);
      }

      // Assert - All PIDs should be different
      const uniquePids = new Set(pids);
      expect(uniquePids.size).toBe(pids.length);
      expect(pids.every(pid => pid > 0)).toBe(true);

      // Cleanup handled by afterEach
    }, 15000);

    it('should not allow starting twice', async () => {
      // Arrange
      await lifecycle.start();

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('MCP server is already running');

      // Cleanup handled by afterEach
    }, 10000);

    it('should recover from process crash', async () => {
      // Arrange - Start the server
      await lifecycle.start();
      const process = (lifecycle as any).currentProcess;
      const firstPid = process.pid;

      // Act - Kill the process externally (simulate crash)
      process.kill('SIGKILL');

      // Wait for process to exit
      await new Promise(resolve => {
        process.once('exit', resolve);
      });

      // Should be able to start again
      await lifecycle.start();

      // Assert - New process should be running
      const secondPid = (lifecycle as any).currentProcess?.pid;
      expect(secondPid).toBeGreaterThan(0);
      expect(secondPid).not.toBe(firstPid);

      // Cleanup handled by afterEach
    }, 10000);
  });

  describe('process communication', () => {
    it('should fail to start when process has no stdin', async () => {
      // Arrange - Create a custom spawner that creates process without stdin
      const customSpawner = new ProcessSpawner();
      customSpawner.spawn = (config) => {
        const { spawn } = require('child_process');
        return spawn(config.command, config.args || [], {
          stdio: ['ignore', 'pipe', 'pipe'], // No stdin!
          cwd: config.cwd,
          env: config.env || process.env
        });
      };

      const noStdinLifecycle = new McpServerLifecycle(
        {
          command: 'node',
          args: [fixtures.TEST_SERVERS.SIMPLE_ECHO]
        },
        new ProcessReadinessChecker({
          checkIntervalMs: 10,
          timeoutMs: 300,
          settleDelayMs: 10
        }),
        new ProcessTerminator({
          closeStdin: false,
          gracePeriodMs: 0,
          forcePeriodMs: 1000,
          zombieTimeoutMs: 500,
          throwOnZombie: true
        }),
        customSpawner
      );

      // Act & Assert - Process should fail (either exits or stdin not ready)
      await expect(noStdinLifecycle.start()).rejects.toThrow(/Process (stdin not ready after timeout|exited during startup)/);

      // Cleanup
      await cleanupLifecycleProcess(noStdinLifecycle);
    }, 10000);

    it('should fail to start when process exits immediately', async () => {
      // Arrange - Use server that exits immediately
      const exitServerPath = fixtures.TEST_SERVERS.EXIT_IMMEDIATELY;
      const exitLifecycle = new McpServerLifecycle(
        {
          command: 'node',
          args: [exitServerPath]
        },
        new ProcessReadinessChecker({
          checkIntervalMs: 100, // Wait 100ms before checking, process will have exited
          timeoutMs: 300,
          settleDelayMs: 0
        }),
        new ProcessTerminator({
          closeStdin: false,
          gracePeriodMs: 0,
          forcePeriodMs: 1000,
          zombieTimeoutMs: 500,
          throwOnZombie: true
        }),
        new ProcessSpawner()
      );

      // Act & Assert - Should fail because process exits before becoming ready
      await expect(exitLifecycle.start()).rejects.toThrow('Process exited during startup');

      // Cleanup
      await cleanupLifecycleProcess(exitLifecycle);
    }, 10000);

    it('should handle stdin closure during operation', async () => {
      // Arrange - Use server that closes stdin after delay
      const stdinTestServerPath = fixtures.TEST_SERVERS.STDIN_TEST;
      const delayedLifecycle = new McpServerLifecycle(
        {
          command: 'node',
          args: [stdinTestServerPath],
          env: { ...process.env, STDIN_TEST_MODE: 'close-after-delay' }
        },
        new ProcessReadinessChecker({
          checkIntervalMs: 10,
          timeoutMs: 100,
          settleDelayMs: 50
        }),
        new ProcessTerminator({
          closeStdin: false,
          gracePeriodMs: 0,
          forcePeriodMs: 1000,
          zombieTimeoutMs: 500,
          throwOnZombie: true
        }),
        new ProcessSpawner()
      );

      // Act - Start should succeed initially
      await delayedLifecycle.start();

      // Wait for stdin to be closed by the server
      await new Promise(resolve => setTimeout(resolve, 300));

      // Assert - Process should still be running after stdin closes
      const childProc = (delayedLifecycle as any).currentProcess;
      expect(childProc).toBeTruthy();
      expect(childProc.killed).toBe(false);

      // Cleanup
      await cleanupLifecycleProcess(delayedLifecycle);
    }, 10000);

    it('should handle process crash after startup', async () => {
      // Arrange - Use server that exits after delay
      const stdinTestServerPath = fixtures.TEST_SERVERS.STDIN_TEST;
      const crashLifecycle = new McpServerLifecycle(
        {
          command: 'node',
          args: [stdinTestServerPath],
          env: { ...process.env, STDIN_TEST_MODE: 'exit-after-delay' }
        },
        new ProcessReadinessChecker({
          checkIntervalMs: 10,
          timeoutMs: 100,
          settleDelayMs: 50
        }),
        new ProcessTerminator({
          closeStdin: false,
          gracePeriodMs: 0,
          forcePeriodMs: 1000,
          zombieTimeoutMs: 500,
          throwOnZombie: true
        }),
        new ProcessSpawner()
      );

      // Act - Start should succeed
      await crashLifecycle.start();

      // Wait for process to crash
      await new Promise(resolve => setTimeout(resolve, 300));

      // Assert - Should be able to restart after crash (process auto-clears on exit)
      const newStreams = await crashLifecycle.start();
      expect(newStreams.stdin).toBeDefined();
      expect(newStreams.stdout).toBeDefined();

      // Cleanup
      await cleanupLifecycleProcess(crashLifecycle);
    }, 10000);
  });
});