import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HotReload } from './hot-reload.js';
import { BuildRunner } from './build-runner.js';
import { FileWatcher } from './file-watcher.js';

jest.mock('./build-runner.js');
jest.mock('./file-watcher.js');

describe('HotReload', () => {
  let hotReload: HotReload;
  let mockBuildRunner: jest.Mocked<BuildRunner>;
  let mockFileWatcher: jest.Mocked<FileWatcher>;
  let mockOnRestart: jest.Mock<() => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockBuildRunner = {
      run: jest.fn<() => boolean>()
    } as unknown as jest.Mocked<BuildRunner>;

    mockFileWatcher = {
      pause: jest.fn<() => boolean>(),
      resume: jest.fn<() => void>(),
      start: jest.fn<() => void>(),
      stop: jest.fn<() => void>()
    } as unknown as jest.Mocked<FileWatcher>;

    mockOnRestart = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    // Mock the constructors
    (BuildRunner as jest.Mock).mockImplementation(() => mockBuildRunner);
    (FileWatcher as jest.Mock).mockImplementation(() => mockFileWatcher);

    hotReload = new HotReload(
      mockBuildRunner,
      mockFileWatcher,
      mockOnRestart
    );
  });

  describe('handleFileChange', () => {
    it('should build and restart when build succeeds', async () => {
      // Arrange
      mockBuildRunner.run.mockReturnValue(true);
      mockFileWatcher.pause.mockReturnValue(false); // No changes during build

      // Act
      await hotReload.handleFileChange();

      // Assert
      expect(mockBuildRunner.run).toHaveBeenCalled();
      expect(mockOnRestart).toHaveBeenCalledTimes(1);
      expect(mockFileWatcher.pause).toHaveBeenCalled();
      expect(mockFileWatcher.resume).toHaveBeenCalled();
    });

    it('should not restart when build fails', async () => {
      // Arrange
      mockBuildRunner.run.mockReturnValue(false);
      mockFileWatcher.pause.mockReturnValue(false);

      // Act
      await hotReload.handleFileChange();

      // Assert
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(1);
      expect(mockOnRestart).not.toHaveBeenCalled();
    });

    it('should retry build when files change during failed build', async () => {
      // Arrange
      mockBuildRunner.run
        .mockReturnValueOnce(false)  // First build fails
        .mockReturnValueOnce(true);  // Second build succeeds

      mockFileWatcher.pause
        .mockReturnValueOnce(false)  // No change before first build
        .mockReturnValueOnce(true)   // Files changed during first build
        .mockReturnValueOnce(false)  // No change before second build
        .mockReturnValueOnce(false); // No change during second build

      // Act
      await hotReload.handleFileChange();

      // Assert
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(2);
      expect(mockOnRestart).toHaveBeenCalledTimes(1);
    });

    it('should rebuild when files change during successful build', async () => {
      // Arrange
      mockBuildRunner.run.mockReturnValue(true); // All builds succeed

      mockFileWatcher.pause
        .mockReturnValueOnce(false)  // No change before first build
        .mockReturnValueOnce(true)   // Files changed during first build
        .mockReturnValueOnce(false)  // No change before second build
        .mockReturnValueOnce(false); // No change during second build

      // Act
      await hotReload.handleFileChange();

      // Assert
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(2);
      expect(mockOnRestart).toHaveBeenCalledTimes(2);
    });

    it('should stop after max build attempts', async () => {
      // Arrange
      mockBuildRunner.run.mockReturnValue(true); // All builds succeed

      // Always return true to simulate continuous file changes
      mockFileWatcher.pause.mockReturnValue(true);

      // Act
      await hotReload.handleFileChange();

      // Assert - Should stop at 3 attempts (MAX_BUILD_ATTEMPTS)
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(3);
      expect(mockOnRestart).toHaveBeenCalledTimes(3);
    });

    it('should handle file changes during delay between builds', async () => {
      // Arrange
      mockBuildRunner.run.mockReturnValue(true);

      let pauseCallCount = 0;
      mockFileWatcher.pause.mockImplementation(() => {
        pauseCallCount++;
        // Return pattern: before-build, during-build, during-delay
        if (pauseCallCount === 2) return true;  // Changed during first build
        if (pauseCallCount === 3) return true;  // Changed during delay
        return false;
      });

      // Act
      await hotReload.handleFileChange();

      // Assert
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(2);
      expect(mockOnRestart).toHaveBeenCalledTimes(2);
    });

    it('should always resume file watching after completion', async () => {
      // Arrange
      mockBuildRunner.run.mockReturnValue(false); // Build fails
      mockFileWatcher.pause.mockReturnValue(false);

      // Act
      await hotReload.handleFileChange();

      // Assert - Final resume should be called
      const resumeCalls = mockFileWatcher.resume.mock.calls.length;
      expect(resumeCalls).toBeGreaterThan(0);
      expect(mockFileWatcher.resume).toHaveBeenLastCalledWith();
    });
  });

  describe('lifecycle', () => {
    it('should start file watcher when started', () => {
      // Act
      hotReload.start();

      // Assert
      expect(mockFileWatcher.start).toHaveBeenCalledTimes(1);
    });

    it('should stop file watcher when stopped', () => {
      // Act
      hotReload.stop();

      // Assert
      expect(mockFileWatcher.stop).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple start calls gracefully', () => {
      // Act
      hotReload.start();
      hotReload.start();
      hotReload.start();

      // Assert
      expect(mockFileWatcher.start).toHaveBeenCalledTimes(3);
    });

    it('should handle multiple stop calls gracefully', () => {
      // Act
      hotReload.stop();
      hotReload.stop();
      hotReload.stop();

      // Assert
      expect(mockFileWatcher.stop).toHaveBeenCalledTimes(3);
    });

    it('should handle start/stop sequence', () => {
      // Act
      hotReload.start();
      hotReload.stop();
      hotReload.start();

      // Assert
      expect(mockFileWatcher.start).toHaveBeenCalledTimes(2);
      expect(mockFileWatcher.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should handle onRestart callback failures gracefully', async () => {
      // Arrange
      const restartError = new Error('Server restart failed');
      mockOnRestart.mockRejectedValue(restartError);
      mockBuildRunner.run.mockReturnValue(true);
      mockFileWatcher.pause.mockReturnValue(false);

      // Act & Assert - Should not throw
      await expect(hotReload.handleFileChange()).rejects.toThrow('Server restart failed');

      // Verify build was attempted and restart was called
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(1);
      expect(mockOnRestart).toHaveBeenCalledTimes(1);
    });

    it('should handle fileWatcher pause exceptions', async () => {
      // Arrange
      const watcherError = new Error('FileWatcher pause failed');
      mockFileWatcher.pause.mockImplementation(() => {
        throw watcherError;
      });
      mockBuildRunner.run.mockReturnValue(true);

      // Act & Assert - Should not throw, but propagate error
      await expect(hotReload.handleFileChange()).rejects.toThrow('FileWatcher pause failed');

      // Verify buildRunner was not called due to watcher failure
      expect(mockBuildRunner.run).not.toHaveBeenCalled();
    });

    it('should handle fileWatcher resume exceptions', async () => {
      // Arrange
      const watcherError = new Error('FileWatcher resume failed');
      mockFileWatcher.pause.mockReturnValue(false);
      mockFileWatcher.resume.mockImplementation(() => {
        throw watcherError;
      });
      mockBuildRunner.run.mockReturnValue(true);

      // Act & Assert - Should not throw, but propagate error
      await expect(hotReload.handleFileChange()).rejects.toThrow('FileWatcher resume failed');

      // Verify build was attempted
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(1);
    });

    it('should handle fileWatcher start exceptions', () => {
      // Arrange
      const watcherError = new Error('FileWatcher start failed');
      mockFileWatcher.start.mockImplementation(() => {
        throw watcherError;
      });

      // Act & Assert
      expect(() => hotReload.start()).toThrow('FileWatcher start failed');
    });

    it('should handle fileWatcher stop exceptions', () => {
      // Arrange
      const watcherError = new Error('FileWatcher stop failed');
      mockFileWatcher.stop.mockImplementation(() => {
        throw watcherError;
      });

      // Act & Assert
      expect(() => hotReload.stop()).toThrow('FileWatcher stop failed');
    });
  });

  describe('concurrent operations', () => {
    it('should handle multiple concurrent handleFileChange calls', async () => {
      // Arrange
      mockBuildRunner.run.mockReturnValue(true);
      mockFileWatcher.pause.mockReturnValue(false);

      // Delay the onRestart callback to simulate concurrent execution
      let restartCount = 0;
      mockOnRestart.mockImplementation(async () => {
        restartCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      // Act - Start multiple concurrent operations
      const promises = [
        hotReload.handleFileChange(),
        hotReload.handleFileChange(),
        hotReload.handleFileChange()
      ];

      await Promise.all(promises);

      // Assert - All operations should complete
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(3);
      expect(restartCount).toBe(3);
    });

    it('should handle concurrent operations with mixed success/failure', async () => {
      // Arrange
      let buildCallCount = 0;
      mockBuildRunner.run.mockImplementation(() => {
        buildCallCount++;
        return buildCallCount % 2 === 1; // Alternate success/failure
      });
      mockFileWatcher.pause.mockReturnValue(false);

      // Act
      const promises = [
        hotReload.handleFileChange(), // Should succeed
        hotReload.handleFileChange(), // Should fail
        hotReload.handleFileChange()  // Should succeed
      ];

      await Promise.all(promises);

      // Assert
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(3);
      expect(mockOnRestart).toHaveBeenCalledTimes(2); // Only successful builds
    });
  });

  describe('stop during active operations', () => {
    it('should handle stop call during active handleFileChange', async () => {
      // Arrange
      mockBuildRunner.run.mockReturnValue(true);
      mockFileWatcher.pause.mockReturnValue(false);

      // Mock onRestart to simulate delay and call stop during execution
      let stopCalled = false;
      mockOnRestart.mockImplementation(async () => {
        // Call stop while restart is in progress
        hotReload.stop();
        stopCalled = true;
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      // Act
      await hotReload.handleFileChange();

      // Assert
      expect(stopCalled).toBe(true);
      expect(mockFileWatcher.stop).toHaveBeenCalledTimes(1);
      expect(mockOnRestart).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple stops during active operations', async () => {
      // Arrange
      mockBuildRunner.run.mockReturnValue(true);
      mockFileWatcher.pause.mockReturnValue(false);

      let stopCallCount = 0;
      mockOnRestart.mockImplementation(async () => {
        // Call stop multiple times during restart
        hotReload.stop();
        hotReload.stop();
        stopCallCount += 2;
        await new Promise(resolve => setTimeout(resolve, 5));
      });

      // Act
      await hotReload.handleFileChange();

      // Assert
      expect(stopCallCount).toBe(2);
      expect(mockFileWatcher.stop).toHaveBeenCalledTimes(2);
    });

    it('should complete active operations before stopping', async () => {
      // Arrange
      mockBuildRunner.run.mockReturnValue(true);
      mockFileWatcher.pause.mockReturnValue(false);

      let operationCompleted = false;
      mockOnRestart.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        operationCompleted = true;
      });

      // Act - Start operation and immediately stop
      const operationPromise = hotReload.handleFileChange();
      hotReload.stop();

      await operationPromise;

      // Assert - Operation should complete despite stop call
      expect(operationCompleted).toBe(true);
      expect(mockOnRestart).toHaveBeenCalledTimes(1);
      expect(mockFileWatcher.stop).toHaveBeenCalledTimes(1);
    });
  });
});