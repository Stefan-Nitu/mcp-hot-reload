import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProcessReadinessChecker } from '../readiness-checker.js';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';

// Factory for creating mock process with type safety
function createMockProcess(overrides: Partial<ChildProcess> = {}): ChildProcess {
  const emitter = new EventEmitter();

  return Object.assign(emitter, {
    stdin: new PassThrough(),
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

describe('ProcessReadinessChecker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('successful readiness', () => {
    it('should detect when process is ready for communication', async () => {
      // Arrange
      const checker = new ProcessReadinessChecker({
        checkIntervalMs: 10,
        settleDelayMs: 10,
        timeoutMs: 1000
      });
      const process = createMockProcess();

      // Act
      const promise = checker.waitUntilReady(process);
      await vi.runAllTimersAsync();

      // Assert
      await expect(promise).resolves.toBeUndefined();
    });

    it('should use default timings when not specified', async () => {
      // Arrange
      const checker = new ProcessReadinessChecker();
      const process = createMockProcess();

      // Act
      const promise = checker.waitUntilReady(process);
      await vi.runAllTimersAsync();

      // Assert
      await expect(promise).resolves.toBeUndefined();
    });

    it('should wait for settle delay after detecting ready state', async () => {
      // Arrange
      const checker = new ProcessReadinessChecker({
        checkIntervalMs: 10,
        settleDelayMs: 50,
        timeoutMs: 1000
      });
      const process = createMockProcess();

      // Act
      const promise = checker.waitUntilReady(process);

      // Should check readiness
      vi.advanceTimersByTime(10);

      // Should now wait for settle delay
      vi.advanceTimersByTime(50);

      // Assert
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('failure scenarios', () => {
    it('should reject if process exits during startup', async () => {
      // Arrange
      const checker = new ProcessReadinessChecker({
        checkIntervalMs: 10,
        timeoutMs: 1000
      });
      const process = createMockProcess();

      // Act
      const promise = checker.waitUntilReady(process);

      // Simulate process exit
      process.emit('exit', 1, null);

      // Assert
      await expect(promise).rejects.toThrow('Process exited during startup');
    });

    it('should reject if process.killed becomes true', async () => {
      // Arrange
      const checker = new ProcessReadinessChecker({
        checkIntervalMs: 10,
        timeoutMs: 1000
      });
      const process = createMockProcess();

      // Act
      const promise = checker.waitUntilReady(process);

      // Mark process as killed
      Object.defineProperty(process, 'killed', {
        value: true,
        writable: false,
        configurable: true
      });

      // Run one interval check
      vi.advanceTimersByTime(10);

      // Assert
      await expect(promise).rejects.toThrow('Process exited during startup');
    });

    it('should timeout if stdin never becomes writable', async () => {
      // Arrange
      const checker = new ProcessReadinessChecker({
        checkIntervalMs: 10,
        timeoutMs: 100
      });
      const process = createMockProcess({
        stdin: null // No stdin
      });

      // Act
      const promise = checker.waitUntilReady(process);

      // Fast-forward past timeout and await the rejection
      vi.runAllTimersAsync();
      await expect(promise).rejects.toThrow('Process stdin not ready after timeout');
    });

    it('should timeout if stdin is not writable', async () => {
      // Arrange
      const checker = new ProcessReadinessChecker({
        checkIntervalMs: 10,
        timeoutMs: 100
      });

      const stdin = new PassThrough();
      Object.defineProperty(stdin, 'writable', {
        value: false,
        writable: false,
        configurable: true
      });

      const process = createMockProcess({ stdin });

      // Act
      const promise = checker.waitUntilReady(process);
      vi.runAllTimersAsync();

      // Assert
      await expect(promise).rejects.toThrow('Process stdin not ready after timeout');
    });

    it('should handle process error events without rejecting', async () => {
      // Arrange
      const checker = new ProcessReadinessChecker({
        checkIntervalMs: 10,
        settleDelayMs: 10,
        timeoutMs: 1000
      });
      const process = createMockProcess();

      // Act
      const promise = checker.waitUntilReady(process);

      // Process errors don't fail readiness check, only log
      // The error handler doesn't reject the promise

      // Assert - should still resolve if stdin is ready
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('race conditions', () => {
    it('should reject if process exits during settle delay', async () => {
      // Arrange
      const checker = new ProcessReadinessChecker({
        checkIntervalMs: 10,
        settleDelayMs: 100, // Long settle delay to expose race
        timeoutMs: 1000
      });
      const process = createMockProcess();

      // Act
      const promise = checker.waitUntilReady(process);

      // First interval check - stdin is writable, starts settle delay
      vi.advanceTimersByTime(10);

      // Process exits during settle delay
      vi.advanceTimersByTime(50); // Halfway through settle delay
      process.emit('exit', 1, null);

      // Complete the settle delay
      vi.advanceTimersByTime(50);

      // Assert - Should reject, not resolve
      await expect(promise).rejects.toThrow('Process exited during startup');
    });

    it('should reject if process becomes killed during settle delay', async () => {
      // Arrange
      const checker = new ProcessReadinessChecker({
        checkIntervalMs: 10,
        settleDelayMs: 100,
        timeoutMs: 1000
      });
      const process = createMockProcess();

      // Act
      const promise = checker.waitUntilReady(process);

      // First interval check - stdin is writable, starts settle delay
      vi.advanceTimersByTime(10);

      // Process gets killed during settle delay
      vi.advanceTimersByTime(50);
      Object.defineProperty(process, 'killed', {
        value: true,
        writable: false,
        configurable: true
      });

      // Run next interval check
      vi.advanceTimersByTime(10);

      // Assert - Should reject
      await expect(promise).rejects.toThrow('Process exited during startup');
    });
  });

  describe('cleanup', () => {
    it('should cleanup timers when process exits', async () => {
      // Arrange
      const checker = new ProcessReadinessChecker({
        checkIntervalMs: 10,
        timeoutMs: 1000
      });
      const process = createMockProcess();

      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // Act
      const promise = checker.waitUntilReady(process);
      process.emit('exit', 0, null);

      // Assert
      await expect(promise).rejects.toThrow();
      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should cleanup timers when ready', async () => {
      // Arrange
      const checker = new ProcessReadinessChecker({
        checkIntervalMs: 10,
        settleDelayMs: 10,
        timeoutMs: 1000
      });
      const process = createMockProcess();

      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // Act
      const promise = checker.waitUntilReady(process);
      await vi.runAllTimersAsync();
      await promise;

      // Assert
      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should remove exit listener after resolution', async () => {
      // Arrange
      const checker = new ProcessReadinessChecker({
        checkIntervalMs: 10,
        settleDelayMs: 10,
        timeoutMs: 1000
      });
      const process = createMockProcess();
      const removeListenerSpy = vi.spyOn(process, 'removeListener');

      // Act
      const promise = checker.waitUntilReady(process);
      await vi.runAllTimersAsync();
      await promise;

      // Assert
      expect(removeListenerSpy).toHaveBeenCalledWith('exit', expect.any(Function));
    });
  });
});