import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProcessTerminator, type TerminationOptions } from '../terminator.js';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';

// Factory for creating mock process with type safety
function createMockProcess(overrides: Partial<ChildProcess> = {}): ChildProcess {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  stdin.end = vi.fn().mockReturnValue(stdin);

  return Object.assign(emitter, {
    stdin,
    stdout: new PassThrough(),
    stderr: null,
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

describe('ProcessTerminator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('terminate', () => {
    it('should close stdin when requested', async () => {
      // Arrange
      const options: TerminationOptions = {
        closeStdin: true,
        gracePeriodMs: 0,
        forcePeriodMs: 100,
        zombieTimeoutMs: 100,
        throwOnZombie: false
      };
      const terminator = new ProcessTerminator(options);
      const process = createMockProcess();

      // Act
      const promise = terminator.terminate(process);
      process.emit('exit', 0, null);

      // Assert
      await promise;
      expect(process.stdin?.end).toHaveBeenCalled();
    });

    it('should send SIGTERM immediately when grace period is 0', async () => {
      // Arrange
      const options: TerminationOptions = {
        closeStdin: false,
        gracePeriodMs: 0,
        forcePeriodMs: 100,
        zombieTimeoutMs: 100,
        throwOnZombie: false
      };
      const terminator = new ProcessTerminator(options);
      const process = createMockProcess();

      // Act
      const promise = terminator.terminate(process);

      // Assert
      expect(process.kill).toHaveBeenCalledWith('SIGTERM');

      process.emit('exit', 0, null);
      await promise;
    });

    it('should wait grace period before sending SIGTERM', async () => {
      // Arrange
      const options: TerminationOptions = {
        closeStdin: false,
        gracePeriodMs: 1000,
        forcePeriodMs: 100,
        zombieTimeoutMs: 100,
        throwOnZombie: false
      };
      const terminator = new ProcessTerminator(options);
      const process = createMockProcess();

      // Act
      const promise = terminator.terminate(process);

      // Assert
      expect(process.kill).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(process.kill).toHaveBeenCalledWith('SIGTERM');

      process.emit('exit', 0, null);
      await promise;
    });

    it('should escalate to SIGKILL after force period', async () => {
      // Arrange
      const options: TerminationOptions = {
        closeStdin: false,
        gracePeriodMs: 0,
        forcePeriodMs: 1000,
        zombieTimeoutMs: 100,
        throwOnZombie: false
      };
      const terminator = new ProcessTerminator(options);
      const process = createMockProcess();

      // Act
      const promise = terminator.terminate(process);

      // Assert
      expect(process.kill).toHaveBeenCalledWith('SIGTERM');

      vi.advanceTimersByTime(1000);
      expect(process.kill).toHaveBeenCalledWith('SIGKILL');

      process.emit('exit', 0, null);
      await promise;
    });

    it('should resolve when process exits', async () => {
      // Arrange
      const options: TerminationOptions = {
        closeStdin: false,
        gracePeriodMs: 0,
        forcePeriodMs: 1000,
        zombieTimeoutMs: 1000,
        throwOnZombie: false
      };
      const terminator = new ProcessTerminator(options);
      const process = createMockProcess();

      // Act
      const promise = terminator.terminate(process);
      process.emit('exit', 0, null);

      // Assert
      await expect(promise).resolves.toBeUndefined();
    });

    it('should throw on zombie when throwOnZombie is true', async () => {
      // Arrange
      const options: TerminationOptions = {
        closeStdin: false,
        gracePeriodMs: 0,
        forcePeriodMs: 100,
        zombieTimeoutMs: 100,
        throwOnZombie: true
      };
      const terminator = new ProcessTerminator(options);
      const process = createMockProcess();

      // Act
      const promise = terminator.terminate(process);
      vi.runAllTimersAsync();

      // Assert
      await expect(promise).rejects.toThrow('zombie');
    });

    it('should resolve on zombie when throwOnZombie is false', async () => {
      // Arrange
      const options: TerminationOptions = {
        closeStdin: false,
        gracePeriodMs: 0,
        forcePeriodMs: 100,
        zombieTimeoutMs: 100,
        throwOnZombie: false
      };
      const terminator = new ProcessTerminator(options);
      const process = createMockProcess();

      // Act
      const promise = terminator.terminate(process);
      await vi.runAllTimersAsync();

      // Assert
      await expect(promise).resolves.toBeUndefined();
    });

    it('should cleanup timeouts when process exits', async () => {
      // Arrange
      const options: TerminationOptions = {
        closeStdin: false,
        gracePeriodMs: 1000,
        forcePeriodMs: 1000,
        zombieTimeoutMs: 1000,
        throwOnZombie: false
      };
      const terminator = new ProcessTerminator(options);
      const process = createMockProcess();
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // Act
      const promise = terminator.terminate(process);
      process.emit('exit', 0, null);
      await promise;

      // Assert
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(3); // 3 timeouts should be cleared
    });
  });

  describe('stop terminator configuration', () => {
    it('should use MCP-compliant shutdown sequence', async () => {
      // Arrange - MCP spec: close stdin, wait, SIGTERM, wait, SIGKILL
      const stopOptions: TerminationOptions = {
        closeStdin: true,
        gracePeriodMs: 1000,
        forcePeriodMs: 2000,
        zombieTimeoutMs: 100,
        throwOnZombie: false
      };
      const terminator = new ProcessTerminator(stopOptions);
      const process = createMockProcess();

      // Act
      const promise = terminator.terminate(process);

      // Assert
      expect(process.stdin?.end).toHaveBeenCalled();

      // Should wait 1s before SIGTERM
      expect(process.kill).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(process.kill).toHaveBeenCalledWith('SIGTERM');

      // Should wait 2s more before SIGKILL
      vi.advanceTimersByTime(2000);
      expect(process.kill).toHaveBeenCalledWith('SIGKILL');

      process.emit('exit', 0, null);
      await promise;
    });
  });

  describe('restart terminator configuration', () => {
    it('should send SIGTERM immediately', async () => {
      // Arrange
      const restartOptions: TerminationOptions = {
        closeStdin: false,
        gracePeriodMs: 0,      // SIGTERM immediately
        forcePeriodMs: 5000,   // SIGKILL after 5s
        zombieTimeoutMs: 5000, // Give up after another 5s
        throwOnZombie: true
      };
      const terminator = new ProcessTerminator(restartOptions);
      const process = createMockProcess();

      // Act
      const promise = terminator.terminate(process);

      // Assert
      expect(process.kill).toHaveBeenCalledWith('SIGTERM');
      expect(process.stdin?.end).not.toHaveBeenCalled();

      process.emit('exit', 0, null);
      await promise;
    });

    it('should throw on zombie process', async () => {
      // Arrange
      const restartOptions: TerminationOptions = {
        closeStdin: false,
        gracePeriodMs: 0,
        forcePeriodMs: 100,
        zombieTimeoutMs: 100,
        throwOnZombie: true
      };
      const terminator = new ProcessTerminator(restartOptions);
      const process = createMockProcess();

      // Act
      const promise = terminator.terminate(process);
      vi.runAllTimersAsync();

      // Assert
      await expect(promise).rejects.toThrow('zombie');
    });
  });
});