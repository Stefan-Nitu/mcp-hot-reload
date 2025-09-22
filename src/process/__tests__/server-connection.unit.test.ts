import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServerConnectionImpl } from '../server-connection.js';
import { ChildProcess } from 'child_process';
import { PassThrough } from 'stream';
import { EventEmitter } from 'events';

describe('ServerConnection', () => {
  let mockProcess: ChildProcess & EventEmitter;
  let stdin: PassThrough;
  let stdout: PassThrough;
  let connection: ServerConnectionImpl;

  beforeEach(() => {
    // Arrange - Create mock process with writable properties
    const emitter = new EventEmitter();
    mockProcess = emitter as ChildProcess & EventEmitter;

    stdin = new PassThrough();
    stdout = new PassThrough();

    // Define configurable properties for testing
    Object.defineProperties(mockProcess, {
      stdin: { value: stdin, writable: true, configurable: true },
      stdout: { value: stdout, writable: true, configurable: true },
      stderr: { value: null, writable: true, configurable: true },
      pid: { value: 12345, writable: true, configurable: true },
      exitCode: { value: null, writable: true, configurable: true },
      signalCode: { value: null, writable: true, configurable: true },
      killed: { value: false, writable: true, configurable: true },
      kill: { value: vi.fn().mockReturnValue(true), writable: true, configurable: true }
    });
  });

  afterEach(() => {
    connection?.dispose();
  });

  describe('constructor', () => {
    it('should expose stdin, stdout, and pid', () => {
      // Act
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);

      // Assert
      expect(connection.stdin).toBe(stdin);
      expect(connection.stdout).toBe(stdout);
      expect(connection.pid).toBe(12345);
    });
  });

  describe('isAlive', () => {
    it('should return true when process is running', () => {
      // Arrange
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);

      // Act & Assert
      expect(connection.isAlive()).toBe(true);
    });

    it('should return false after process exits', async () => {
      // Arrange
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);

      // Act - Simulate process exit
      Object.defineProperty(mockProcess, 'exitCode', { value: 0, configurable: true });
      mockProcess.emit('exit', 0, null);

      // Assert
      expect(connection.isAlive()).toBe(false);
    });

    it('should return false when process is killed', () => {
      // Arrange
      Object.defineProperty(mockProcess, 'killed', { value: true, configurable: true });
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);

      // Act & Assert
      expect(connection.isAlive()).toBe(false);
    });
  });

  describe('waitForCrash', () => {
    it('should resolve with exit code when process exits normally', async () => {
      // Arrange
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);

      // Act - Simulate normal exit
      const crashPromise = connection.waitForCrash();
      Object.defineProperty(mockProcess, 'exitCode', { value: 0, configurable: true });
      mockProcess.emit('exit', 0, null);

      // Assert
      const result = await crashPromise;
      expect(result).toEqual({ code: 0, signal: null });
    });

    it('should resolve with exit code when process crashes', async () => {
      // Arrange
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);

      // Act - Simulate crash with non-zero exit
      const crashPromise = connection.waitForCrash();
      Object.defineProperty(mockProcess, 'exitCode', { value: 1, configurable: true });
      mockProcess.emit('exit', 1, null);

      // Assert
      const result = await crashPromise;
      expect(result).toEqual({ code: 1, signal: null });
    });

    it('should resolve with signal when process is killed', async () => {
      // Arrange
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);

      // Act - Simulate killed by signal
      const crashPromise = connection.waitForCrash();
      Object.defineProperty(mockProcess, 'signalCode', { value: 'SIGTERM', configurable: true });
      mockProcess.emit('exit', null, 'SIGTERM');

      // Assert
      const result = await crashPromise;
      expect(result).toEqual({ code: null, signal: 'SIGTERM' });
    });

    it('should return the same promise on multiple calls', () => {
      // Arrange
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);

      // Act
      const promise1 = connection.waitForCrash();
      const promise2 = connection.waitForCrash();

      // Assert - Should be the exact same promise instance
      expect(promise1).toBe(promise2);
    });

    it('should resolve even if called after process has already exited', async () => {
      // Arrange
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);

      // Act - Exit before calling waitForCrash
      Object.defineProperty(mockProcess, 'exitCode', { value: 42, configurable: true });
      mockProcess.emit('exit', 42, null);

      const result = await connection.waitForCrash();

      // Assert
      expect(result).toEqual({ code: 42, signal: null });
    });
  });

  describe('dispose', () => {
    it('should remove exit listener from process', () => {
      // Arrange
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);
      const removeListenerSpy = vi.spyOn(mockProcess, 'removeListener');

      // Act
      connection.dispose();

      // Assert
      expect(removeListenerSpy).toHaveBeenCalledWith('exit', expect.any(Function));
    });

    it('should be safe to call multiple times', () => {
      // Arrange
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);

      // Act & Assert - Should not throw
      expect(() => {
        connection.dispose();
        connection.dispose();
        connection.dispose();
      }).not.toThrow();
    });

    it('should prevent crash detection after dispose', async () => {
      // Arrange
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);
      const crashPromise = connection.waitForCrash();

      // Act - Dispose removes the listener
      connection.dispose();

      // Now emit exit - this should NOT resolve the promise
      Object.defineProperty(mockProcess, 'exitCode', { value: 99, configurable: true });
      mockProcess.emit('exit', 99, null);

      // Assert - Promise should not resolve (will timeout in test if it doesn't)
      // We'll race with a timeout to verify it doesn't resolve
      const timeoutPromise = new Promise((resolve) =>
        setTimeout(() => resolve('timeout'), 100)
      );

      const result = await Promise.race([crashPromise, timeoutPromise]);
      expect(result).toBe('timeout');
    });
  });

  describe('integration scenarios', () => {
    it('should handle rapid exit after creation', async () => {
      // Arrange & Act - Create and immediately exit
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);
      Object.defineProperty(mockProcess, 'exitCode', { value: 1, configurable: true });
      mockProcess.emit('exit', 1, null);

      // Assert
      expect(connection.isAlive()).toBe(false);
      const result = await connection.waitForCrash();
      expect(result.code).toBe(1);
    });

    it('should handle SIGKILL signal', async () => {
      // Arrange
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);

      // Act - Simulate SIGKILL
      const crashPromise = connection.waitForCrash();
      Object.defineProperty(mockProcess, 'killed', { value: true, configurable: true });
      Object.defineProperty(mockProcess, 'signalCode', { value: 'SIGKILL', configurable: true });
      mockProcess.emit('exit', null, 'SIGKILL');

      // Assert
      expect(connection.isAlive()).toBe(false);
      const result = await crashPromise;
      expect(result).toEqual({ code: null, signal: 'SIGKILL' });
    });

    it('should work with async/await pattern', async () => {
      // Arrange
      connection = new ServerConnectionImpl(stdin, stdout, 12345, mockProcess);

      // Act - Set up async monitoring
      const monitoringStarted = Date.now();
      const monitorPromise = (async () => {
        const { code, signal } = await connection.waitForCrash();
        return { code, signal, duration: Date.now() - monitoringStarted };
      })();

      // Simulate some delay then crash
      await new Promise(resolve => setTimeout(resolve, 10));
      Object.defineProperty(mockProcess, 'exitCode', { value: 137, configurable: true });
      mockProcess.emit('exit', 137, null);

      // Assert
      const result = await monitorPromise;
      expect(result.code).toBe(137);
      expect(result.signal).toBeNull();
      expect(result.duration).toBeGreaterThanOrEqual(10);
    });
  });
});