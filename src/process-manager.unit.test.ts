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

  it('starts a process and returns it', async () => {
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

    // Assert
    expect(spawn).toHaveBeenCalledWith(
      'node',
      ['test.js'],
      {
        stdio: ['pipe', 'pipe', 'inherit'],
        cwd: '/test',
        env: expect.objectContaining({ TEST: 'true' })
      }
    );
    expect(process).toBe(mockProcess);
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

  it('stops a running process gracefully', async () => {
    // Arrange
    const mockProcess = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: null, // Using 'inherit' for stderr
      pid: 123,
      kill: jest.fn(),
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

    // Assert
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockProcess.removeAllListeners).toHaveBeenCalled();
  });

  it('forces termination if process does not exit gracefully', async () => {
    // Arrange
    const mockProcess = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: null, // Using 'inherit' for stderr
      pid: 123,
      kill: jest.fn(),
      once: jest.fn(), // Don't trigger exit event
      removeAllListeners: jest.fn()
    };
    (spawn as jest.Mock).mockReturnValue(mockProcess);
    await processManager.start({ command: 'node', args: ['test.js'] });

    // Act
    await processManager.stop(100); // Short timeout for test

    // Assert
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
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

  it('starts process with minimal configuration - no cwd or env', async () => {
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

    // Assert
    expect(spawn).toHaveBeenCalledWith(
      'echo',
      ['hello'],
      {
        stdio: ['pipe', 'pipe', 'inherit'],
        cwd: undefined,
        env: expect.any(Object)
      }
    );
    expect(process).toBe(mockProcess);
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

  it('handles process that exits during grace period', async () => {
    // Arrange
    const mockProcess = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: null,
      pid: 333,
      kill: jest.fn(),
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

    // Assert
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockProcess.kill).not.toHaveBeenCalledWith('SIGKILL');
    expect(mockProcess.removeAllListeners).toHaveBeenCalled();
  });
});