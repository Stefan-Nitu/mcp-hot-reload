import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HotReload } from '../hot-reload.js';
import { BuildRunner } from '../build-runner.js';
import { FileWatcher } from '../file-watcher.js';

// Use vi.hoisted to define mocks that need to be available in vi.mock
const { mockBuildRunner, mockFileWatcher } = vi.hoisted(() => {
  const mockBuildRunner = {
    run: vi.fn<() => Promise<boolean>>(),
    cancel: vi.fn()
  };

  const mockFileWatcher = {
    start: vi.fn(),
    stop: vi.fn(),
    waitForChange: vi.fn().mockResolvedValue([])
  };

  return { mockBuildRunner, mockFileWatcher };
});

vi.mock('../build-runner.js', () => ({
  BuildRunner: vi.fn(() => mockBuildRunner)
}));

vi.mock('../file-watcher.js', () => ({
  FileWatcher: vi.fn().mockImplementation(() => mockFileWatcher)
}));

describe('HotReload', () => {
  let hotReload: HotReload;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations to default behavior
    mockBuildRunner.run.mockResolvedValue(false);
    mockBuildRunner.cancel.mockReturnValue(undefined);
    mockFileWatcher.start.mockReturnValue(undefined);
    mockFileWatcher.stop.mockReturnValue(undefined);
    mockFileWatcher.waitForChange.mockResolvedValue(undefined);

    hotReload = new HotReload(
      new BuildRunner('', ''),
      new FileWatcher({ patterns: '' })
    );
  });

  describe('buildOnChange', () => {
    it('should cancel any ongoing build before starting a new one', async () => {
      // Arrange
      mockBuildRunner.run.mockResolvedValue(true);

      // Act
      const result = await hotReload.buildOnChange();

      // Assert
      expect(result).toBe(true);
      expect(mockBuildRunner.cancel).toHaveBeenCalledTimes(1);
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(1);
    });

    it('should return true when build succeeds', async () => {
      // Arrange
      mockBuildRunner.run.mockResolvedValue(true);

      // Act
      const result = await hotReload.buildOnChange();

      // Assert
      expect(result).toBe(true);
      expect(mockBuildRunner.run).toHaveBeenCalled();
    });

    it('should return false when build fails', async () => {
      // Arrange
      mockBuildRunner.run.mockResolvedValue(false);

      // Act
      const result = await hotReload.buildOnChange();

      // Assert
      expect(result).toBe(false);
      expect(mockBuildRunner.cancel).toHaveBeenCalledTimes(1);
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple build requests by cancelling previous builds', async () => {
      // Arrange
      mockBuildRunner.run.mockResolvedValue(true);

      // Act - Simulate rapid build requests
      const results = await Promise.all([
        hotReload.buildOnChange(),
        hotReload.buildOnChange(),
        hotReload.buildOnChange()
      ]);

      // Assert - All should succeed
      expect(results).toEqual([true, true, true]);
      expect(mockBuildRunner.cancel).toHaveBeenCalledTimes(3);
      expect(mockBuildRunner.run).toHaveBeenCalledTimes(3);
    });
  });

  describe('waitForChange', () => {
    it('should delegate to fileWatcher.waitForChange', async () => {
      // Arrange
      const changedFiles = ['src/file1.ts', 'src/file2.ts'];
      mockFileWatcher.waitForChange.mockResolvedValue(changedFiles);

      // Act
      const result = await hotReload.waitForChange();

      // Assert
      expect(mockFileWatcher.waitForChange).toHaveBeenCalledTimes(1);
      expect(result).toEqual(changedFiles);
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
    it('should handle build runner exceptions', async () => {
      // Arrange
      const buildError = new Error('Build failed');
      mockBuildRunner.run.mockRejectedValue(buildError);

      // Act & Assert
      await expect(hotReload.buildOnChange()).rejects.toThrow('Build failed');
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
    it('should handle multiple concurrent build requests', async () => {
      // Arrange
      let buildCount = 0;
      mockBuildRunner.run.mockImplementation(async () => {
        buildCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return true;
      });

      // Act - Trigger multiple concurrent builds
      const results = await Promise.all([
        hotReload.buildOnChange(),
        hotReload.buildOnChange(),
        hotReload.buildOnChange()
      ]);

      // Assert - All should return true
      expect(results).toEqual([true, true, true]);
      expect(buildCount).toBe(3);
    });

    it('should cancel previous builds when new build starts', async () => {
      // Arrange
      let activeBuilds = 0;
      let maxConcurrentBuilds = 0;

      mockBuildRunner.run.mockImplementation(async () => {
        activeBuilds++;
        maxConcurrentBuilds = Math.max(maxConcurrentBuilds, activeBuilds);
        await new Promise(resolve => setTimeout(resolve, 50));
        activeBuilds--;
        return true;
      });

      // Act - Start builds with small delays
      const promise1 = hotReload.buildOnChange();
      await new Promise(resolve => setTimeout(resolve, 10));
      const promise2 = hotReload.buildOnChange();
      await new Promise(resolve => setTimeout(resolve, 10));
      const promise3 = hotReload.buildOnChange();

      await Promise.all([promise1, promise2, promise3]);

      // Assert - Builds should be cancelled, so max concurrent should be low
      expect(mockBuildRunner.cancel).toHaveBeenCalled();
    });

    it('should handle mixed success/failure in concurrent builds', async () => {
      // Arrange
      mockBuildRunner.run
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      // Act
      const results = await Promise.all([
        hotReload.buildOnChange(),
        hotReload.buildOnChange(),
        hotReload.buildOnChange()
      ]);

      // Assert - Results should reflect the pattern we set
      expect(results).toEqual([true, false, true]);
    });
  });

  describe('cancel operation', () => {
    it('should cancel active builds', () => {
      // Act
      hotReload.cancel();

      // Assert
      expect(mockBuildRunner.cancel).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple cancel calls', () => {
      // Act
      hotReload.cancel();
      hotReload.cancel();
      hotReload.cancel();

      // Assert
      expect(mockBuildRunner.cancel).toHaveBeenCalledTimes(3);
    });

    it('should cancel during active build', async () => {
      // Arrange
      let buildCompleted = false;
      mockBuildRunner.run.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        buildCompleted = true;
        return true;
      });

      // Act - Start build and immediately cancel
      const buildPromise = hotReload.buildOnChange();
      hotReload.cancel();

      await buildPromise;

      // Assert - Build should still complete (cancellation is cooperative)
      expect(buildCompleted).toBe(true);
      expect(mockBuildRunner.cancel).toHaveBeenCalledTimes(2); // Once in buildOnChange, once from cancel()
    });
  });
});