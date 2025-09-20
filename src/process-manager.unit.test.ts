import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProcessManager } from './process-manager.js';
import { PassThrough, Readable, Writable } from 'stream';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

vi.mock('child_process');

// Helper to create a mock ChildProcess
function createMockProcess(overrides: Partial<ChildProcess> = {}): ChildProcess {
  const defaults: Partial<ChildProcess> = {
    stdin: new PassThrough() as Writable,
    stdout: new PassThrough() as Readable,
    stderr: null,
    pid: 123,
    kill: vi.fn().mockReturnValue(true),
    once: vi.fn(),
    removeAllListeners: vi.fn()
  };
  return { ...defaults, ...overrides } as ChildProcess;
}

describe('ProcessManager', () => {
  let processManager: ProcessManager;

  beforeEach(() => {
    processManager = new ProcessManager();
    vi.clearAllMocks();
  });

  it('starts a process and returns it with accessible streams', async () => {
    // Arrange
    const mockProcess = createMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess);

    // Act
    const process = await processManager.start({
      command: 'node',
      args: ['test.js'],
      cwd: '/test',
      env: { TEST: 'true' }
    });

    // Assert - Test behavior: process is returned with accessible streams
    expect(process).toBeDefined();
    expect(process.stdin).toBeDefined();
    expect(process.stdout).toBeDefined();
    expect(process.pid).toBe(123);
  });

  it('throws error if streams are not created', async () => {
    // Arrange
    const mockProcess = {
      pid: 123
    };
    vi.mocked(spawn).mockReturnValue(mockProcess);

    // Act & Assert
    await expect(processManager.start({
      command: 'node',
      args: ['test.js']
    })).rejects.toThrow('Failed to create process streams');
  });

  it('stops a running process and completes successfully', async () => {
    // Arrange
    const mockProcess = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: null, // Using 'inherit' for stderr
      pid: 123,
      kill: vi.fn<() => boolean>().mockReturnValue(true),
      once: vi.fn((event: string, callback: () => void) => {
        if (event === 'exit') {
          setTimeout(callback, 10);
        }
      }),
      removeAllListeners: vi.fn()
    };
    vi.mocked(spawn).mockReturnValue(mockProcess);
    await processManager.start({ command: 'node', args: ['test.js'] });

    // Act
    await processManager.stop();

    // Assert - Test behavior: stop completes without error
    expect(mockProcess.kill).toHaveBeenCalled();
    // Process should be stopped (verify behavior not implementation)
  });

  it('ensures process termination even if it does not respond to stop signal', async () => {
    // Arrange
    const mockProcess = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: null, // Using 'inherit' for stderr
      pid: 123,
      kill: vi.fn<() => boolean>().mockReturnValue(true),
      once: vi.fn(), // Don't trigger exit event
      removeAllListeners: vi.fn()
    };
    vi.mocked(spawn).mockReturnValue(mockProcess);
    await processManager.start({ command: 'node', args: ['test.js'] });

    // Act
    await processManager.stop(100); // Short timeout for test

    // Assert - Test behavior: process is forcefully terminated
    expect(mockProcess.kill).toHaveBeenCalledTimes(2); // Called twice for force termination
  });

  it('handles stop when no process is running', async () => {
    // Act & Assert - should not throw
    await expect(processManager.stop()).resolves.toBeUndefined();
  });

  it('handles process spawn failure - command not found', async () => {
    // Arrange
    const mockError = new Error('spawn nonexistent ENOENT');
    (spawn as vi.Mock).mockImplementation(() => {
      throw mockError;
    });

    // Act & Assert
    await expect(processManager.start({
      command: 'nonexistent',
      args: ['arg1']
    })).rejects.toThrow('spawn nonexistent ENOENT');
  });

  it('starts process successfully with minimal configuration', async () => {
    // Arrange
    const mockProcess = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: null,
      pid: 456,
      kill: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn()
    };
    vi.mocked(spawn).mockReturnValue(mockProcess);

    // Act
    const process = await processManager.start({
      command: 'echo',
      args: ['hello']
    });

    // Assert - Test behavior: process starts successfully
    expect(process).toBeDefined();
    expect(process.pid).toBe(456);
    expect(process.stdin).toBeDefined();
    expect(process.stdout).toBeDefined();
  });

  it('replaces existing process when starting new one', async () => {
    // Arrange
    const firstMockProcess = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: null,
      pid: 789,
      kill: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn()
    };
    const secondMockProcess = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: null,
      pid: 101,
      kill: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn()
    };
    (spawn as vi.Mock)
      .mockReturnValueOnce(firstMockProcess)
      .mockReturnValueOnce(secondMockProcess);

    // Act
    const firstProcess = await processManager.start({
      command: 'node',
      args: ['first.js']
    });
    const secondProcess = await processManager.start({
      command: 'node',
      args: ['second.js']
    });

    // Assert
    expect(firstProcess).toBe(firstMockProcess);
    expect(secondProcess).toBe(secondMockProcess);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('throws error when stdin stream is not created', async () => {
    // Arrange
    const mockProcess = {
      stdin: null,
      stdout: new PassThrough(),
      stderr: null,
      pid: 111
    };
    vi.mocked(spawn).mockReturnValue(mockProcess);

    // Act & Assert
    await expect(processManager.start({
      command: 'node',
      args: ['test.js']
    })).rejects.toThrow('Failed to create process streams');
  });

  it('throws error when stdout stream is not created', async () => {
    // Arrange
    const mockProcess = {
      stdin: new PassThrough(),
      stdout: null,
      stderr: null,
      pid: 222
    };
    vi.mocked(spawn).mockReturnValue(mockProcess);

    // Act & Assert
    await expect(processManager.start({
      command: 'node',
      args: ['test.js']
    })).rejects.toThrow('Failed to create process streams');
  });

  it('waits for process to exit gracefully before forcing termination', async () => {
    // Arrange
    const mockProcess = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: null,
      pid: 333,
      kill: vi.fn<() => boolean>().mockReturnValue(true),
      once: vi.fn<(event: string, callback: () => void) => void>((event: string, callback: () => void) => {
        if (event === 'exit') {
          // Simulate process exiting during grace period
          setTimeout(callback, 50);
        }
      }),
      removeAllListeners: vi.fn()
    };
    vi.mocked(spawn).mockReturnValue(mockProcess);
    await processManager.start({ command: 'node', args: ['test.js'] });

    // Act
    await processManager.stop(1000); // Longer timeout to allow graceful exit

    // Assert - Test behavior: process stops gracefully without force
    expect(mockProcess.kill).toHaveBeenCalledTimes(1); // Only called once for graceful shutdown
  });
});