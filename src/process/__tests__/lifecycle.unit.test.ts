import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServerLifecycle, type McpServerConfig } from '../lifecycle.js';
import { ProcessReadinessChecker } from '../readiness-checker.js';
import { ProcessTerminator, type TerminationOptions } from '../terminator.js';
import { ProcessSpawner } from '../spawner.js';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';

// Factory for creating typed mocks with full type safety
function createMockProcessSpawner(): ProcessSpawner {
  return {
    spawn: vi.fn<ProcessSpawner['spawn']>()
  };
}

function createMockReadinessChecker(): ProcessReadinessChecker {
  const checker = new ProcessReadinessChecker({
    checkIntervalMs: 100,
    timeoutMs: 5000,
    settleDelayMs: 10
  });
  checker.waitUntilReady = vi.fn<ProcessReadinessChecker['waitUntilReady']>();
  return checker;
}

function createMockTerminator(options?: TerminationOptions): ProcessTerminator {
  return new ProcessTerminator(options || {
    closeStdin: false,
    gracePeriodMs: 0,
    forcePeriodMs: 1000,
    zombieTimeoutMs: 1000,
    throwOnZombie: false
  });
}

// Override the terminate method with a mock
function mockTerminatorTerminate(terminator: ProcessTerminator): void {
  terminator.terminate = vi.fn<ProcessTerminator['terminate']>().mockResolvedValue(undefined);
}

function createMockChildProcess(overrides: Partial<ChildProcess> = {}): ChildProcess {
  const emitter = new EventEmitter();

  // Merge EventEmitter methods with ChildProcess properties
  return Object.assign(emitter, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 123,
    killed: false,
    exitCode: null,
    signalCode: null,
    spawnargs: [],
    spawnfile: '',
    kill: vi.fn().mockReturnValue(true),
    send: vi.fn().mockReturnValue(true),
    disconnect: vi.fn(),
    unref: vi.fn(),
    ref: vi.fn(),
    ...overrides
  }) as ChildProcess;
}

describe('McpServerLifecycle', () => {
  let lifecycle: McpServerLifecycle;
  let mockSpawner: ProcessSpawner;
  let mockReadinessChecker: ProcessReadinessChecker;
  let mockRestartTerminator: ProcessTerminator;
  let mockChildProcess: ChildProcess;
  let config: McpServerConfig;

  beforeEach(() => {
    // Arrange
    mockChildProcess = createMockChildProcess();
    mockSpawner = createMockProcessSpawner();
    mockReadinessChecker = createMockReadinessChecker();

    // Create restart terminator with appropriate options
    mockRestartTerminator = createMockTerminator({
      closeStdin: false,
      gracePeriodMs: 0,
      forcePeriodMs: 5000,
      zombieTimeoutMs: 5000,
      throwOnZombie: true
    });

    // Mock the terminate method
    mockTerminatorTerminate(mockRestartTerminator);

    // Setup default mock behaviors
    vi.mocked(mockSpawner.spawn).mockReturnValue(mockChildProcess);
    vi.mocked(mockReadinessChecker.waitUntilReady).mockResolvedValue(undefined);

    config = {
      command: 'node',
      args: ['test.js'],
      cwd: '/test',
      env: { TEST: 'value' }
    };

    lifecycle = new McpServerLifecycle(
      config,
      mockReadinessChecker,
      mockRestartTerminator,
      mockSpawner
    );
  });

  describe('start', () => {
    it('should spawn process and wait for readiness', async () => {
      // Act
      await lifecycle.start();

      // Assert
      expect(mockSpawner.spawn).toHaveBeenCalledWith({
        command: 'node',
        args: ['test.js'],
        cwd: '/test',
        env: { TEST: 'value' }
      });
      expect(mockReadinessChecker.waitUntilReady).toHaveBeenCalledWith(mockChildProcess);
    });

    it('should not allow starting twice', async () => {
      // Arrange
      await lifecycle.start();

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('MCP server is already running');
    });

    it('should handle spawn failures', async () => {
      // Arrange
      const error = new Error('Spawn failed');
      vi.mocked(mockSpawner.spawn).mockImplementation(() => { throw error; });

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('Spawn failed');
    });

    it('should fail if spawned process has no stdin', async () => {
      // Arrange
      const processWithoutStdin = createMockChildProcess({ stdin: null });
      vi.mocked(mockSpawner.spawn).mockReturnValue(processWithoutStdin);

      // Spawner should throw if stdin is missing
      vi.mocked(mockSpawner.spawn).mockImplementation(() => {
        throw new Error('Failed to create process streams');
      });

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('Failed to create process streams');
    });

    it('should fail if spawned process has no stdout', async () => {
      // Arrange
      const processWithoutStdout = createMockChildProcess({ stdout: null });
      vi.mocked(mockSpawner.spawn).mockReturnValue(processWithoutStdout);

      // Spawner should throw if stdout is missing
      vi.mocked(mockSpawner.spawn).mockImplementation(() => {
        throw new Error('Failed to create process streams');
      });

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('Failed to create process streams');
    });

    it('should handle readiness check failures', async () => {
      // Arrange
      const error = new Error('Readiness check failed');
      vi.mocked(mockReadinessChecker.waitUntilReady).mockRejectedValue(error);

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('Readiness check failed');
    });

    it('should track unexpected process exits', async () => {
      // Arrange
      await lifecycle.start();

      // Act
      mockChildProcess.emit('exit', 1, null);

      // Assert - process should be cleared, allowing restart with new streams
      const streams = await lifecycle.start();
      expect(streams).toEqual({
        stdin: mockChildProcess.stdin,
        stdout: mockChildProcess.stdout
      });
    });

    it('should fail to start if process exits during readiness check', async () => {
      // Arrange
      vi.mocked(mockReadinessChecker.waitUntilReady).mockImplementation(async (process) => {
        // Simulate process exiting during readiness check
        process.emit('exit', 1, null);
        throw new Error('Process exited during startup');
      });

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('Process exited during startup');
    });

    it('should fail to start if stdin is not writable', async () => {
      // Arrange
      const nonWritableProcess = createMockChildProcess();
      Object.defineProperty(nonWritableProcess.stdin, 'writable', {
        value: false,
        writable: false,
        configurable: true
      });
      vi.mocked(mockSpawner.spawn).mockReturnValue(nonWritableProcess);

      // Make readiness checker reject for non-writable stdin
      vi.mocked(mockReadinessChecker.waitUntilReady).mockRejectedValue(
        new Error('Process stdin not ready after timeout')
      );

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('Process stdin not ready after timeout');
    });

    it('should register error handler for process', async () => {
      // Arrange
      const errorSpy = vi.spyOn(mockChildProcess, 'on');

      // Act
      await lifecycle.start();

      // Assert
      expect(errorSpy).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('restart', () => {
    it('should stop and start process with new instance', async () => {
      // Arrange
      await lifecycle.start();
      const firstProcess = mockChildProcess;

      // Create new mock process for restart
      const newMockProcess = createMockChildProcess({ pid: 456 });
      vi.mocked(mockSpawner.spawn).mockReturnValue(newMockProcess);

      // Act
      await lifecycle.restart();

      // Assert
      expect(mockRestartTerminator.terminate).toHaveBeenCalledWith(firstProcess);
      expect(mockSpawner.spawn).toHaveBeenCalledTimes(2);
      expect(mockReadinessChecker.waitUntilReady).toHaveBeenCalledTimes(2);
      expect(mockReadinessChecker.waitUntilReady).toHaveBeenLastCalledWith(newMockProcess);
    });

    it('should start process if not already running', async () => {
      // Act
      await lifecycle.restart();

      // Assert
      expect(mockSpawner.spawn).toHaveBeenCalledOnce();
      expect(mockRestartTerminator.terminate).not.toHaveBeenCalled();
    });

    it('should handle restart failures gracefully', async () => {
      // Arrange
      await lifecycle.start();
      const error = new Error('Restart spawn failed');

      // Reset the mock and set up new behavior
      vi.mocked(mockSpawner.spawn).mockReset();
      vi.mocked(mockSpawner.spawn)
        .mockImplementationOnce(() => { throw error; }); // Restart fails on spawn

      // Act & Assert
      await expect(lifecycle.restart()).rejects.toThrow('Restart spawn failed');
    });

    it('should handle termination errors during restart', async () => {
      // Arrange
      await lifecycle.start();
      const error = new Error('Termination failed');
      vi.mocked(mockRestartTerminator.terminate).mockRejectedValue(error);

      // Act & Assert
      await expect(lifecycle.restart()).rejects.toThrow('Termination failed');
    });
  });
});