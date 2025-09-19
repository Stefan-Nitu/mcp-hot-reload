import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { BuildRunner } from './build-runner.js';
import * as child_process from 'child_process';

jest.mock('child_process');

describe('BuildRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when build succeeds', () => {
    // Arrange
    const execSyncMock = child_process.execSync as jest.Mock;
    execSyncMock.mockReturnValue('');
    const buildRunner = new BuildRunner('npm run build', '/project');

    // Act
    const result = buildRunner.run();

    // Assert
    expect(execSyncMock).toHaveBeenCalledWith('npm run build', {
      stdio: 'ignore',
      cwd: '/project',
      timeout: 60000
    });
    expect(result).toBe(true);
  });

  it('returns false when build fails', () => {
    // Arrange
    const execSyncMock = child_process.execSync as jest.Mock;
    execSyncMock.mockImplementation(() => {
      throw new Error('Build failed');
    });
    const buildRunner = new BuildRunner('npm run build', '/project');

    // Act
    const result = buildRunner.run();

    // Assert
    expect(result).toBe(false);
  });

  it('returns true when no command provided', () => {
    // Arrange
    const execSyncMock = child_process.execSync as jest.Mock;
    const buildRunner = new BuildRunner('', '/project');

    // Act
    const result = buildRunner.run();

    // Assert
    expect(execSyncMock).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('returns true for whitespace-only command', () => {
    // Arrange
    const execSyncMock = child_process.execSync as jest.Mock;
    const buildRunner = new BuildRunner('   ', '/project');

    // Act
    const result = buildRunner.run();

    // Assert
    expect(execSyncMock).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('uses custom timeout when provided', () => {
    // Arrange
    const execSyncMock = child_process.execSync as jest.Mock;
    execSyncMock.mockReturnValue('');
    const buildRunner = new BuildRunner('npm run build', '/project', 120000);

    // Act
    buildRunner.run();

    // Assert
    expect(execSyncMock).toHaveBeenCalledWith('npm run build', {
      stdio: 'ignore',
      cwd: '/project',
      timeout: 120000
    });
  });
});