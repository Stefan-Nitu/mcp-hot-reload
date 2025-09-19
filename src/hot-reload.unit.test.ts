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
      run: jest.fn<() => Promise<boolean>>(),
      cancel: jest.fn<() => void>()
    } as unknown as jest.Mocked<BuildRunner>;

    mockFileWatcher = {
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
    it('should cancel any ongoing build before starting a new one', async () => {
      // Arrange
      mockBuildRunner.run.mockResolvedValue(true);

      // Act
      await hotReload.handleFileChange();

      // Assert
      expect(mockBuildRunner.cancel).toHaveBeenCalledTimes(1);
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(1);
      expect(mockOnRestart).toHaveBeenCalledTimes(1);
    });

    it('should build and restart when build succeeds', async () => {
      // Arrange
      mockBuildRunner.run.mockResolvedValue(true);

      // Act
      await hotReload.handleFileChange();

      // Assert
      expect(mockBuildRunner.run).toHaveBeenCalled();
      expect(mockOnRestart).toHaveBeenCalledTimes(1);
    });

    it('should not restart when build fails', async () => {
      // Arrange
      mockBuildRunner.run.mockResolvedValue(false);

      // Act
      await hotReload.handleFileChange();

      // Assert
      expect(mockBuildRunner.cancel).toHaveBeenCalledTimes(1);
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(1);
      expect(mockOnRestart).not.toHaveBeenCalled();
    });

    it('should handle multiple file changes by cancelling and restarting', async () => {
      // Arrange
      mockBuildRunner.run.mockResolvedValue(true);

      // Act - Simulate rapid file changes
      await hotReload.handleFileChange();
      await hotReload.handleFileChange();
      await hotReload.handleFileChange();

      // Assert - Cancel should be called before each build
      expect(mockBuildRunner.cancel).toHaveBeenCalledTimes(3);
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(3);
      expect(mockOnRestart).toHaveBeenCalledTimes(3);
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

    it('should allow multiple start calls without errors', () => {
      // Act
      hotReload.start();
      hotReload.start();
      hotReload.start();

      // Assert
      expect(mockFileWatcher.start).toHaveBeenCalledTimes(3);
    });

    it('should allow multiple stop calls without errors', () => {
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
    it('should propagate onRestart callback errors to caller', async () => {
      // Arrange
      const restartError = new Error('Server restart failed');
      mockOnRestart.mockRejectedValue(restartError);
      mockBuildRunner.run.mockResolvedValue(true);

      // Act & Assert - Should throw when restart fails
      await expect(hotReload.handleFileChange()).rejects.toThrow('Server restart failed');

      // Verify build was attempted and restart was called
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(1);
      expect(mockOnRestart).toHaveBeenCalledTimes(1);
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
      mockBuildRunner.run.mockResolvedValue(true);

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
      mockBuildRunner.run.mockImplementation(async () => {
        buildCallCount++;
        return buildCallCount % 2 === 1; // Alternate success/failure
      });

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
      mockBuildRunner.run.mockResolvedValue(true);

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
      mockBuildRunner.run.mockResolvedValue(true);

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
      mockBuildRunner.run.mockResolvedValue(true);

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