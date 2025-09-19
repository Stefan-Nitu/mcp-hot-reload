import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ProcessManager } from './process-manager.js';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';

jest.mock('child_process');

describe('ProcessManager', () => {
  let processManager: ProcessManager;

  beforeEach(() => {
    processManager = new ProcessManager();
    jest.clearAllMocks();
  });

  it('starts a process and returns it with accessible streams', async () => {
    // Arrange
    const mockProcess = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: null, // Using 'inherit' for stderr
      pid: 123,
      kill: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn()
    };
    (spawn as jest.Mock).mockReturnValue(mockProcess);

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
    (spawn as jest.Mock).mockReturnValue(mockProcess);

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
      kill: jest.fn<() => boolean>().mockReturnValue(true),
      once: jest.fn((event: string, callback: () => void) => {
        if (event === 'exit') {
          setTimeout(callback, 10);
        }
      }),
      removeAllListeners: jest.fn()
    };
    (spawn as jest.Mock).mockReturnValue(mockProcess);
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
      kill: jest.fn<() => boolean>().mockReturnValue(true),
      once: jest.fn(), // Don't trigger exit event
      removeAllListeners: jest.fn()
    };
    (spawn as jest.Mock).mockReturnValue(mockProcess);
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
    (spawn as jest.Mock).mockImplementation(() => {
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
      kill: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn()
    };
    (spawn as jest.Mock).mockReturnValue(mockProcess);

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
      kill: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn()
    };
    const secondMockProcess = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: null,
      pid: 101,
      kill: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn()
    };
    (spawn as jest.Mock)
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
    (spawn as jest.Mock).mockReturnValue(mockProcess);

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
    (spawn as jest.Mock).mockReturnValue(mockProcess);

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
      kill: jest.fn<() => boolean>().mockReturnValue(true),
      once: jest.fn<(event: string, callback: () => void) => void>((event: string, callback: () => void) => {
        if (event === 'exit') {
          // Simulate process exiting during grace period
          setTimeout(callback, 50);
        }
      }),
      removeAllListeners: jest.fn()
    };
    (spawn as jest.Mock).mockReturnValue(mockProcess);
    await processManager.start({ command: 'node', args: ['test.js'] });

    // Act
    await processManager.stop(1000); // Longer timeout to allow graceful exit

    // Assert - Test behavior: process stops gracefully without force
    expect(mockProcess.kill).toHaveBeenCalledTimes(1); // Only called once for graceful shutdown
  });
});