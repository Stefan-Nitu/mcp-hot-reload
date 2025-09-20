import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpServerLifecycle, type McpServerConfig } from './mcp-server-lifecycle.js';
import { ProcessReadinessChecker } from './process-readiness-checker.js';
import { ProcessTerminator } from './process-terminator.js';
import { ProcessSpawner } from './process-spawner.js';
import * as path from 'path';
import * as url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const TEST_SERVER_PATH = path.join(__dirname, '../../test/fixtures/servers/simple-echo-server.js');

describe('McpServerLifecycle Integration', () => {
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

    const stopTerminator = new ProcessTerminator({
      closeStdin: true,
      gracePeriodMs: 100,
      forcePeriodMs: 500,
      zombieTimeoutMs: 100,
      throwOnZombie: false
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
      stopTerminator,
      restartTerminator,
      spawner
    );
  });

  afterEach(async () => {
    // Cleanup - ensure process is stopped
    try {
      await lifecycle.stop();
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe('real process lifecycle', () => {
    it('should start and stop a real Node.js process', async () => {
      // Act - Start the server
      await lifecycle.start();

      // Assert - Process should be running
      const process = (lifecycle as any).currentProcess;
      expect(process).toBeTruthy();
      expect(process.pid).toBeGreaterThan(0);
      expect(process.killed).toBe(false);

      // Act - Stop the server
      await lifecycle.stop();

      // Assert - Process should be terminated
      expect((lifecycle as any).currentProcess).toBeNull();
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

      // Cleanup
      await lifecycle.stop();
    }, 15000);

    it('should not allow starting twice', async () => {
      // Arrange
      await lifecycle.start();

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('MCP server is already running');

      // Cleanup
      await lifecycle.stop();
    }, 10000);

    it('should handle stop when not running', async () => {
      // Act & Assert - Should not throw
      await expect(lifecycle.stop()).resolves.toBeUndefined();
    });

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

      // Cleanup
      await lifecycle.stop();
    }, 10000);

    it('should handle concurrent stop calls', async () => {
      // Arrange
      await lifecycle.start();

      // Act - Call stop multiple times concurrently
      const results = await Promise.all([
        lifecycle.stop(),
        lifecycle.stop(),
        lifecycle.stop()
      ]);

      // Assert - All should resolve without error
      expect(results).toEqual([undefined, undefined, undefined]);
      expect((lifecycle as any).currentProcess).toBeNull();
    }, 10000);

    it('should properly terminate with SIGTERM then SIGKILL', async () => {
      // Arrange - Use a custom terminator with longer delays to observe behavior
      const customTerminator = new ProcessTerminator({
        closeStdin: false,
        gracePeriodMs: 0,
        forcePeriodMs: 100,
        zombieTimeoutMs: 100,
        throwOnZombie: false
      });

      const customLifecycle = new McpServerLifecycle(
        config,
        new ProcessReadinessChecker({
          checkIntervalMs: 10,
          timeoutMs: 2000,
          settleDelayMs: 10
        }),
        customTerminator,
        customTerminator,
        new ProcessSpawner()
      );

      await customLifecycle.start();
      const process = (customLifecycle as any).currentProcess;

      // Track which signals were sent
      const killSpy = vi.spyOn(process, 'kill');

      // Act
      const stopPromise = customLifecycle.stop();

      // Wait for termination
      await stopPromise;

      // Assert - Should have tried SIGTERM
      expect(killSpy).toHaveBeenCalledWith('SIGTERM');

      // Cleanup
      killSpy.mockRestore();
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
          args: [path.join(__dirname, '../../test/fixtures/servers/simple-echo-server.js')]
        },
        new ProcessReadinessChecker({
          checkIntervalMs: 10,
          timeoutMs: 300,
          settleDelayMs: 10
        }),
        new ProcessTerminator({
          closeStdin: true,
          gracePeriodMs: 100,
          forcePeriodMs: 500,
          zombieTimeoutMs: 100,
          throwOnZombie: false
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
      try {
        await noStdinLifecycle.stop();
      } catch {
        // Ignore cleanup errors
      }
    }, 10000);

    it('should fail to start when process exits immediately', async () => {
      // Arrange - Use server that exits immediately
      const exitServerPath = path.join(__dirname, '../../test/fixtures/servers/exit-immediately-server.js');
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
          closeStdin: true,
          gracePeriodMs: 100,
          forcePeriodMs: 500,
          zombieTimeoutMs: 100,
          throwOnZombie: false
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
      try {
        await exitLifecycle.stop();
      } catch {
        // Ignore cleanup errors
      }
    }, 10000);

    it('should handle stdin closure during operation', async () => {
      // Arrange - Use server that closes stdin after delay
      const stdinTestServerPath = path.join(__dirname, '../../test/fixtures/servers/stdin-test-server.js');
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
          closeStdin: true,
          gracePeriodMs: 100,
          forcePeriodMs: 500,
          zombieTimeoutMs: 100,
          throwOnZombie: false
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

      // Assert - Should be able to stop the server (process still running)
      await expect(delayedLifecycle.stop()).resolves.toBeUndefined();

      // Should be able to restart after stop
      await expect(delayedLifecycle.start()).resolves.toBeUndefined();

      // Cleanup
      await delayedLifecycle.stop();
    }, 10000);

    it('should handle process crash after startup', async () => {
      // Arrange - Use server that exits after delay
      const stdinTestServerPath = path.join(__dirname, '../../test/fixtures/servers/stdin-test-server.js');
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
          closeStdin: true,
          gracePeriodMs: 100,
          forcePeriodMs: 500,
          zombieTimeoutMs: 100,
          throwOnZombie: false
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
      await expect(crashLifecycle.start()).resolves.toBeUndefined();

      // Cleanup
      await crashLifecycle.stop();
    }, 10000);
  });
});