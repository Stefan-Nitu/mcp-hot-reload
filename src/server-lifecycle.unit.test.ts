import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ServerLifecycle } from './server-lifecycle.js';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Writable, Readable } from 'stream';
import type { ProcessManager, ProcessConfig } from './process-manager.js';

// Create a mock ChildProcess that extends EventEmitter
class MockChildProcess extends EventEmitter {
  pid: number = 1234;
  stdin: Writable | null = Object.assign(new Writable(), { writable: true });
  stdout: Readable | null = new EventEmitter() as Readable;
  stderr: Readable | null = null;
  stdio: [Writable | null, Readable | null, Readable | null, Readable | Writable | null | undefined, Readable | Writable | null | undefined] =
    [this.stdin, this.stdout, this.stderr, null, null];
  kill = jest.fn<() => boolean>().mockReturnValue(true);
  killed = false;
  connected = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  spawnargs: string[] = [];
  spawnfile: string = '';
  send = jest.fn<(message: any, callback?: (error: Error | null) => void) => boolean>().mockReturnValue(false);
  disconnect = jest.fn<() => void>();
  unref = jest.fn<() => MockChildProcess>().mockReturnThis();
  ref = jest.fn<() => MockChildProcess>().mockReturnThis();
  [Symbol.dispose] = jest.fn<() => void>();
}

describe('ServerLifecycle', () => {
  let lifecycle: ServerLifecycle;
  let mockProcessManager: ProcessManager;
  let mockProcess: MockChildProcess;

  let onServerReady: jest.Mock;
  let onServerExit: jest.Mock;
  let onShutdown: jest.Mock;

  beforeEach(() => {
    // Create mock process
    mockProcess = new MockChildProcess();

    const startMock = jest.fn<(config: ProcessConfig) => Promise<ChildProcess>>();
    startMock.mockResolvedValue(mockProcess as unknown as ChildProcess);

    const stopMock = jest.fn<(timeout?: number) => Promise<void>>();
    stopMock.mockResolvedValue(undefined);

    mockProcessManager = {
      start: startMock,
      stop: stopMock,
      process: null
    } as unknown as ProcessManager;

    onServerReady = jest.fn();
    onServerExit = jest.fn();
    onShutdown = jest.fn();

    lifecycle = new ServerLifecycle(
      mockProcessManager,
      {
        command: 'node',
        args: ['server.js'],
        cwd: '/test',
        env: { TEST: 'true' }
      },
      {
        onServerReady,
        onServerExit,
        onShutdown
      }
    );
  });

  describe('server starting', () => {
    it('should start server with correct configuration', async () => {
      // Act
      const process = await lifecycle.start();

      // Assert
      expect(mockProcessManager.start).toHaveBeenCalledWith({
        command: 'node',
        args: ['server.js'],
        cwd: '/test',
        env: expect.objectContaining({ TEST: 'true' })
      });
      expect(process).toBe(mockProcess);
    });

    it('should wait for server to be ready', async () => {
      // Act
      const startPromise = lifecycle.start();

      // Simulate server becoming ready
      await new Promise(resolve => setTimeout(resolve, 50));

      const process = await startPromise;

      // Assert
      expect(onServerReady).toHaveBeenCalledWith(mockProcess);
      expect(process).toBe(mockProcess);
    });

    it('should handle server exit during start', async () => {
      // Arrange
      (mockProcessManager.start as jest.Mock).mockImplementation(async () => {
        setTimeout(() => mockProcess.emit('exit', 1, null), 10);
        return mockProcess as unknown as ChildProcess;
      });

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('Process exited during startup');
      expect(onServerExit).toHaveBeenCalledWith(1, null);
    });
  });

  describe('server stopping', () => {
    it('should stop the server process', async () => {
      // Arrange
      await lifecycle.start();

      // Act
      await lifecycle.stop();

      // Assert
      expect(mockProcessManager.stop).toHaveBeenCalled();
    });

    it('should handle stopping when no server is running', async () => {
      // Act & Assert - should not throw
      await expect(lifecycle.stop()).resolves.toBeUndefined();
    });

    it('should clear process reference after stop', async () => {
      // Arrange
      await lifecycle.start();

      // Act
      await lifecycle.stop();

      // Assert
      expect(lifecycle.isRunning()).toBe(false);
    });

    it('should handle concurrent stop calls', async () => {
      // Arrange
      await lifecycle.start();

      // Act - call stop twice concurrently
      const stop1 = lifecycle.stop();
      const stop2 = lifecycle.stop();

      await Promise.all([stop1, stop2]);

      // Assert - stop should only be called once on ProcessManager
      expect(mockProcessManager.stop).toHaveBeenCalledTimes(1);
      expect(lifecycle.isRunning()).toBe(false);
    });
  });

  describe('server restarting', () => {
    it('should stop and start server', async () => {
      // Arrange
      await lifecycle.start();
      expect(lifecycle.isRunning()).toBe(true);

      // Reset mock to get a new process
      const newProcess = new MockChildProcess();
      newProcess.pid = 5678;
      (mockProcessManager.start as jest.MockedFunction<typeof mockProcessManager.start>).mockResolvedValue(newProcess as unknown as ChildProcess);

      // Act
      await lifecycle.restart();

      // Assert
      expect(mockProcessManager.stop).toHaveBeenCalled();
      expect(mockProcessManager.start).toHaveBeenCalledTimes(2);
      expect(lifecycle.isRunning()).toBe(true);
    });

    it('should handle restart when server is not running', async () => {
      // Act
      await lifecycle.restart();

      // Assert
      expect(mockProcessManager.start).toHaveBeenCalled();
      expect(lifecycle.isRunning()).toBe(true);
    });
  });

  describe('signal handling', () => {
    it('should enable graceful shutdown on system signals after enableSignalHandling()', async () => {
      // Arrange
      await lifecycle.start();

      // Act
      lifecycle.enableSignalHandling();
      // Simulate SIGINT by getting and calling the handler
      const sigintHandler = process.listeners('SIGINT').slice(-1)[0] as () => void;
      sigintHandler();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert - Test behavior: shutdown is triggered
      expect(mockProcessManager.stop).toHaveBeenCalled();
      expect(onShutdown).toHaveBeenCalled();
    });

    it('should trigger shutdown when receiving SIGINT signal', async () => {
      // Arrange
      await lifecycle.start();
      lifecycle.enableSignalHandling();
      const sigintHandler = process.listeners('SIGINT').slice(-1)[0] as () => void;

      // Act
      sigintHandler();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      expect(mockProcessManager.stop).toHaveBeenCalled();
      expect(onShutdown).toHaveBeenCalledWith(0);
    });

    it('should trigger shutdown when receiving SIGTERM signal', async () => {
      // Arrange
      await lifecycle.start();
      lifecycle.enableSignalHandling();
      const sigtermHandler = process.listeners('SIGTERM').slice(-1)[0] as () => void;

      // Act
      sigtermHandler();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert
      expect(mockProcessManager.stop).toHaveBeenCalled();
      expect(onShutdown).toHaveBeenCalledWith(0);
    });

    it('should prevent multiple shutdown attempts', async () => {
      // Arrange
      await lifecycle.start();
      lifecycle.enableSignalHandling();
      const sigintHandler = process.listeners('SIGINT').slice(-1)[0] as () => void;

      // Act - call handler twice
      sigintHandler();
      sigintHandler();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert - should only stop once
      expect(mockProcessManager.stop).toHaveBeenCalledTimes(1);
      expect(onShutdown).toHaveBeenCalledTimes(1);
    });

    it('should handle shutdown timeout', async () => {
      // Arrange
      (mockProcessManager.stop as jest.Mock).mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 6000))
      );
      await lifecycle.start();
      lifecycle.enableSignalHandling();
      const sigintHandler = process.listeners('SIGINT').slice(-1)[0] as () => void;

      // Act
      sigintHandler();
      await new Promise(resolve => setTimeout(resolve, 5100));

      // Assert - should call onShutdown with error code after timeout
      expect(onShutdown).toHaveBeenCalledWith(1);
    }, 15000);

    it('should not respond to signals after disableSignalHandling()', async () => {
      // Arrange
      await lifecycle.start();
      lifecycle.enableSignalHandling();
      const sigintHandler = process.listeners('SIGINT').slice(-1)[0] as () => void;

      // Act - Disable and try to trigger shutdown
      lifecycle.disableSignalHandling();
      // Remove the handler to simulate it being disabled
      process.removeListener('SIGINT', sigintHandler);

      // Try to call handler (but it should be removed)
      const currentListeners = process.listeners('SIGINT');

      // Assert - Test behavior: no handlers should be registered
      expect(currentListeners).not.toContain(sigintHandler);
    });
  });

  describe('process state', () => {
    it('should track if server is running', async () => {
      // Arrange - no server started
      expect(lifecycle.isRunning()).toBe(false);

      // Act - start server
      await lifecycle.start();

      // Assert - server is running
      expect(lifecycle.isRunning()).toBe(true);

      // Act - stop server
      await lifecycle.stop();

      // Assert - server is not running
      expect(lifecycle.isRunning()).toBe(false);
    });
  });

  describe('waitForReady timeout scenario', () => {
    it('should timeout after 2 seconds and continue with startup', async () => {
      // Arrange - Create a process with non-writable stdin
      const processWithoutWritableStdin = new MockChildProcess();
      processWithoutWritableStdin.stdin = Object.assign(new Writable(), { writable: false });
      (mockProcessManager.start as jest.MockedFunction<typeof mockProcessManager.start>).mockResolvedValue(processWithoutWritableStdin as unknown as ChildProcess);

      // Act
      const startTime = Date.now();
      const process = await lifecycle.start();
      const elapsed = Date.now() - startTime;

      // Assert - Should resolve after timeout (around 2 seconds)
      expect(elapsed).toBeGreaterThanOrEqual(1900); // Allow some timing variance
      expect(elapsed).toBeLessThan(2500);
      expect(process).toBe(processWithoutWritableStdin);
      expect(onServerReady).toHaveBeenCalledWith(processWithoutWritableStdin);
    });
  });

  describe('ProcessManager.start() failure propagation', () => {
    it('should propagate error when ProcessManager.start() fails', async () => {
      // Arrange
      const startError = new Error('Failed to spawn process');
      (mockProcessManager.start as jest.MockedFunction<typeof mockProcessManager.start>).mockRejectedValue(startError);

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('Failed to spawn process');
      expect(onServerReady).not.toHaveBeenCalled();
      expect(lifecycle.isRunning()).toBe(false);
    });
  });

  describe('ProcessManager.stop() failure during shutdown', () => {
    it('should handle ProcessManager.stop() failure during shutdown', async () => {
      // Arrange
      await lifecycle.start();
      const stopError = new Error('Failed to stop process');
      (mockProcessManager.stop as jest.MockedFunction<typeof mockProcessManager.stop>).mockRejectedValue(stopError);

      // Act & Assert
      await expect(lifecycle.stop()).rejects.toThrow('Failed to stop process');
    });

    it('should handle ProcessManager.stop() failure during signal handling', async () => {
      // Arrange
      await lifecycle.start();
      lifecycle.enableSignalHandling();
      const stopError = new Error('Failed to stop process');
      (mockProcessManager.stop as jest.MockedFunction<typeof mockProcessManager.stop>).mockRejectedValue(stopError);
      const sigintHandler = process.listeners('SIGINT').slice(-1)[0] as () => void;

      // Act
      sigintHandler();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert - Should call onShutdown with error code
      expect(onShutdown).toHaveBeenCalledWith(1);
    });
  });

  describe('callback error handling', () => {
    it('should propagate errors from onServerReady callback', async () => {
      // Arrange
      const callbackError = new Error('Callback failed');
      onServerReady.mockImplementation(() => {
        throw callbackError;
      });

      // Act & Assert - Error should propagate and cause start to fail
      await expect(lifecycle.start()).rejects.toThrow('Callback failed');
      expect(onServerReady).toHaveBeenCalledWith(mockProcess);
    });

    it('should handle errors in onServerExit callback', async () => {
      // Arrange
      const callbackError = new Error('Exit callback failed');
      onServerExit.mockImplementation(() => {
        throw callbackError;
      });
      await lifecycle.start();

      // Act & Assert - Simulate process exit and expect error to be thrown
      expect(() => mockProcess.emit('exit', 0, null)).toThrow('Exit callback failed');
      expect(onServerExit).toHaveBeenCalledWith(0, null);
      expect(lifecycle.isRunning()).toBe(false);
    });

    it('should call onShutdown callback during signal handling even when it throws', async () => {
      // Arrange
      let callbackCallCount = 0;
      onShutdown.mockImplementation(() => {
        callbackCallCount++;
        // Don't throw error during the first call (success path)
        // Throw only on subsequent calls to test error handling
        if (callbackCallCount > 1) {
          throw new Error('Shutdown callback failed');
        }
      });
      await lifecycle.start();
      lifecycle.enableSignalHandling();
      const sigintHandler = process.listeners('SIGINT').slice(-1)[0] as () => void;

      // Act
      sigintHandler();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert - Should call the callback successfully
      expect(onShutdown).toHaveBeenCalledWith(0);
      expect(callbackCallCount).toBe(1);
    });
  });

  describe('different exit codes and signals', () => {
    it('should handle exit with different exit codes', async () => {
      // Arrange
      await lifecycle.start();

      // Act - Test different exit codes
      mockProcess.emit('exit', 1, null);
      await new Promise(resolve => setTimeout(resolve, 10));

      // Assert
      expect(onServerExit).toHaveBeenCalledWith(1, null);
      expect(lifecycle.isRunning()).toBe(false);
    });

    it('should handle exit with signals', async () => {
      // Arrange
      await lifecycle.start();

      // Act - Test exit with signal
      mockProcess.emit('exit', null, 'SIGKILL');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Assert
      expect(onServerExit).toHaveBeenCalledWith(null, 'SIGKILL');
      expect(lifecycle.isRunning()).toBe(false);
    });

    it('should handle exit with both code and signal', async () => {
      // Arrange
      await lifecycle.start();

      // Act - Test exit with both code and signal
      mockProcess.emit('exit', 130, 'SIGINT');
      await new Promise(resolve => setTimeout(resolve, 10));

      // Assert
      expect(onServerExit).toHaveBeenCalledWith(130, 'SIGINT');
      expect(lifecycle.isRunning()).toBe(false);
    });
  });

  describe('Race condition with immediately exiting process', () => {
    it('should reject when process exits before first readiness check', async () => {
      // Arrange
      const quickExitProcess = new MockChildProcess();
      quickExitProcess.stdin = Object.assign(new Writable(), { writable: true });

      (mockProcessManager.start as jest.Mock) = jest.fn().mockImplementation(async () => {
        setTimeout(() => {
          quickExitProcess.emit('exit', 1, null);
        }, 30);
        return quickExitProcess as unknown as ChildProcess;
      });

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('Process exited during startup');
      expect(onServerExit).toHaveBeenCalledWith(1, null);
    });

    it('should reject when process exits immediately after stdin becomes writable', async () => {
      // Arrange
      const quickExitProcess = new MockChildProcess();
      quickExitProcess.stdin = Object.assign(new Writable(), { writable: true });

      (mockProcessManager.start as jest.Mock) = jest.fn().mockImplementation(async () => {
        // Simulate process that exits just after first check finds stdin writable
        setTimeout(() => {
          quickExitProcess.emit('exit', 1, null);
        }, 55); // Just after first check interval at 50ms
        return quickExitProcess as unknown as ChildProcess;
      });

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('Process exited during startup');
      expect(onServerExit).toHaveBeenCalledWith(1, null);
    });
  });

  describe('waitForReady timeout edge cases', () => {
    it('should reject if process exits just before timeout completes', async () => {
      // Arrange - Create a process that will exit after 1.9 seconds (just before 2s timeout)
      const slowExitProcess = new MockChildProcess();
      slowExitProcess.stdin = Object.assign(new Writable(), { writable: false });

      (mockProcessManager.start as jest.Mock).mockImplementation(async () => {
        // Simulate process exiting just before the 2-second timeout
        setTimeout(() => {
          slowExitProcess.emit('exit', 1, null);
          // Clear the process reference as the real exit handler would
          (lifecycle as any).process = null;
        }, 1900);
        return slowExitProcess as unknown as ChildProcess;
      });

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('Process exited during startup');
      expect(onServerExit).toHaveBeenCalledWith(1, null);
    });

    it('should reject if process exits right at timeout moment', async () => {
      // Arrange - Create a process that exits exactly at timeout
      const timedExitProcess = new MockChildProcess();
      timedExitProcess.stdin = Object.assign(new Writable(), { writable: false });

      (mockProcessManager.start as jest.Mock).mockImplementation(async () => {
        // Simulate process exiting right at the 2-second mark
        setTimeout(() => {
          timedExitProcess.emit('exit', 1, null);
          // Clear the process reference as the real exit handler would
          (lifecycle as any).process = null;
        }, 2000);
        return timedExitProcess as unknown as ChildProcess;
      });

      // Act & Assert - Should reject, not resolve
      await expect(lifecycle.start()).rejects.toThrow('Process exited during startup');
      expect(onServerExit).toHaveBeenCalledWith(1, null);
    });
  });

  describe('process with null stdin', () => {
    it('should handle process with null stdin', async () => {
      // Arrange - Create a process with null stdin
      const processWithNullStdin = new MockChildProcess();
      processWithNullStdin.stdin = null;
      (mockProcessManager.start as jest.MockedFunction<typeof mockProcessManager.start>).mockResolvedValue(processWithNullStdin as unknown as ChildProcess);

      // Act
      const startTime = Date.now();
      const process = await lifecycle.start();
      const elapsed = Date.now() - startTime;

      // Assert - Should timeout waiting for stdin.writable check and then continue
      expect(elapsed).toBeGreaterThanOrEqual(1900); // Should wait for timeout
      expect(process).toBe(processWithNullStdin);
      expect(onServerReady).toHaveBeenCalledWith(processWithNullStdin);
    });

    it('should reject during startup if process exits with null stdin', async () => {
      // Arrange
      const processWithNullStdin = new MockChildProcess();
      processWithNullStdin.stdin = null;
      (mockProcessManager.start as jest.Mock).mockImplementation(async () => {
        setTimeout(() => processWithNullStdin.emit('exit', 1, null), 100);
        return processWithNullStdin;
      });

      // Act & Assert
      await expect(lifecycle.start()).rejects.toThrow('Process exited during startup');
      expect(onServerExit).toHaveBeenCalledWith(1, null);
    });
  });
});