import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { FileWatcher } from './file-watcher.js';
import chokidar from 'chokidar';

jest.mock('chokidar');

interface MockChokidarWatcher {
  on: jest.Mock;
  close: jest.Mock;
  add: jest.Mock;
  unwatch: jest.Mock;
}

describe('FileWatcher', () => {
  let watcher: FileWatcher;
  let mockChokidarWatcher: MockChokidarWatcher;
  let onChange: jest.Mock<() => void>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Setup mock chokidar watcher
    mockChokidarWatcher = {
      on: jest.fn().mockReturnThis(),
      close: jest.fn(),
      add: jest.fn(),
      unwatch: jest.fn()
    };
    (chokidar.watch as jest.Mock).mockReturnValue(mockChokidarWatcher);

    onChange = jest.fn();
  });

  afterEach(() => {
    if (watcher) {
      watcher.stop();
    }
    jest.useRealTimers();
  });

  describe('Basic Operations', () => {
    it('should start watching specified patterns', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        onChange
      });

      // Act
      watcher.start();

      // Assert
      expect(chokidar.watch).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('src')]),
        expect.objectContaining({
          persistent: true,
          ignoreInitial: true,
          ignored: expect.arrayContaining(['**/node_modules/**', '**/.git/**', '**/dist/**'])
        })
      );
    });

    it('should handle array of patterns', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: ['./src', './lib'],
        onChange
      });

      // Act
      watcher.start();

      // Assert
      expect(chokidar.watch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('src'),
          expect.stringContaining('lib')
        ]),
        expect.any(Object)
      );
    });

    it('should stop watching when stopped', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        onChange
      });
      watcher.start();

      // Act
      watcher.stop();

      // Assert
      expect(mockChokidarWatcher.close).toHaveBeenCalled();
    });
  });

  describe('Change Detection', () => {
    it('should call onChange for matching file changes', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        onChange
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act
      changeHandler?.('src/index.ts');

      // Assert
      expect(onChange).toHaveBeenCalled();
    });

    it('should filter by file extensions when no glob pattern', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        debounceMs: 0,  // Disable debounce for immediate testing
        onChange
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - TypeScript file should trigger
      changeHandler?.('src/index.ts');
      expect(onChange).toHaveBeenCalledTimes(1);

      // Act - README should not trigger
      onChange.mockClear();
      changeHandler?.('src/README.md');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('should respect glob patterns', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: 'src/**/*.ts',
        debounceMs: 0,  // Disable debounce for immediate testing
        onChange,
        cwd: '/test'  // Set a known cwd for testing
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - .ts file should trigger (use absolute paths)
      changeHandler?.('/test/src/index.ts');
      expect(onChange).toHaveBeenCalledTimes(1);

      // Act - .js file should not trigger
      onChange.mockClear();
      changeHandler?.('/test/src/index.js');
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Pause/Resume with Change Tracking', () => {
    it('should track changes while paused', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        onChange
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act
      const hadChanges1 = watcher.pause();
      changeHandler?.('src/index.ts');
      changeHandler?.('src/other.ts');
      const hadChanges2 = watcher.pause();

      // Assert
      expect(hadChanges1).toBe(false); // No changes before first pause
      expect(hadChanges2).toBe(true);  // Changes detected during pause
      expect(onChange).not.toHaveBeenCalled(); // onChange not called while paused
    });

    it('should resume normal operation after resume', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        onChange
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act
      watcher.pause();
      changeHandler?.('src/index.ts'); // During pause
      expect(onChange).not.toHaveBeenCalled();

      watcher.resume();
      changeHandler?.('src/other.ts'); // After resume

      // Assert
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('should clear change flag on resume', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        onChange
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act
      watcher.pause();
      changeHandler?.('src/index.ts');
      watcher.resume();
      const hadChanges = watcher.pause();

      // Assert
      expect(hadChanges).toBe(false);
    });
  });

  describe('Debouncing', () => {
    jest.useFakeTimers();

    it('should debounce rapid changes', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        debounceMs: 100,
        onChange
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - Multiple rapid changes
      changeHandler?.('src/file1.ts');
      changeHandler?.('src/file2.ts');
      changeHandler?.('src/file3.ts');

      // Assert - onChange not called immediately
      expect(onChange).not.toHaveBeenCalled();

      // Act - Advance timers
      jest.advanceTimersByTime(100);

      // Assert - onChange called once after debounce
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('should reset debounce timer on new changes', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        debounceMs: 100,
        onChange
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act
      changeHandler?.('src/file1.ts');
      jest.advanceTimersByTime(50);
      changeHandler?.('src/file2.ts');
      jest.advanceTimersByTime(50);
      changeHandler?.('src/file3.ts');
      jest.advanceTimersByTime(50);

      // Assert - Still not called (timer kept resetting)
      expect(onChange).not.toHaveBeenCalled();

      // Act - Wait for full debounce period
      jest.advanceTimersByTime(50);

      // Assert - Now it should be called
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    jest.useRealTimers();
  });

  describe('Error Handling', () => {
    it('should handle chokidar error events gracefully', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        onChange
      });
      watcher.start();
      const errorHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'error'
      )?.[1] as ((error: Error) => void) | undefined;

      // Act - Simulate chokidar error
      const mockError = new Error('ENOENT: no such file or directory');
      errorHandler?.(mockError);

      // Assert - Should not throw or crash, error should be logged
      expect(() => errorHandler?.(mockError)).not.toThrow();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should not start watching when already started', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        onChange
      });
      watcher.start();
      const firstCallCount = (chokidar.watch as jest.Mock).mock.calls.length;

      // Act - Try to start again
      watcher.start();

      // Assert - chokidar.watch should not be called again
      expect((chokidar.watch as jest.Mock).mock.calls.length).toBe(firstCallCount);
    });

    it('should handle stopping when not started gracefully', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        onChange
      });

      // Act & Assert - Should not throw when stopping without starting
      expect(() => watcher.stop()).not.toThrow();
      expect(mockChokidarWatcher.close).not.toHaveBeenCalled();
    });

    it('should handle empty patterns array gracefully', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: [],
        onChange
      });

      // Act
      watcher.start();

      // Assert - Should not call chokidar.watch with empty targets
      expect(chokidar.watch).not.toHaveBeenCalled();
    });
  });

  describe('File Event Types', () => {
    it('should handle add event for new files', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        debounceMs: 0,
        onChange
      });
      watcher.start();
      const addHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'add'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - Simulate 'add' event
      addHandler?.('src/new-file.ts');

      // Assert - onChange should be called for new files
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('should filter add events by file extensions', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        debounceMs: 0,
        onChange
      });
      watcher.start();
      const addHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'add'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - Add TypeScript file (should trigger)
      addHandler?.('src/new-file.ts');
      expect(onChange).toHaveBeenCalledTimes(1);

      // Act - Add non-source file (should not trigger)
      onChange.mockClear();
      addHandler?.('src/README.md');
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('State Management', () => {
    it('should handle stop while paused', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        onChange
      });
      watcher.start();
      watcher.pause();

      // Act - Stop while paused
      watcher.stop();

      // Assert - Should stop cleanly and reset state
      expect(mockChokidarWatcher.close).toHaveBeenCalled();

      // Starting again should work normally
      watcher.start();
      expect(chokidar.watch).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple pause/resume cycles correctly', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        onChange
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act & Assert - First pause/resume cycle
      let hadChanges = watcher.pause();
      expect(hadChanges).toBe(false);

      changeHandler?.('src/file1.ts');
      hadChanges = watcher.pause();
      expect(hadChanges).toBe(true);

      watcher.resume();
      changeHandler?.('src/file2.ts');
      expect(onChange).toHaveBeenCalledTimes(1);

      // Act & Assert - Second pause/resume cycle
      onChange.mockClear();
      hadChanges = watcher.pause();
      expect(hadChanges).toBe(false);

      changeHandler?.('src/file3.ts');
      changeHandler?.('src/file4.ts');
      hadChanges = watcher.pause();
      expect(hadChanges).toBe(true);

      watcher.resume();
      changeHandler?.('src/file5.ts');
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('should clear debounce timer when stopping', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        debounceMs: 100,
        onChange
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - Trigger change and stop before debounce completes
      changeHandler?.('src/file.ts');
      watcher.stop();
      jest.advanceTimersByTime(100);

      // Assert - onChange should not be called after stop
      expect(onChange).not.toHaveBeenCalled();
    });

    it('should reset pause state when stopping', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        onChange
      });
      watcher.start();
      watcher.pause();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;
      changeHandler?.('src/file.ts');

      // Act - Stop and restart
      watcher.stop();
      watcher.start();
      changeHandler?.('src/file2.ts');

      // Assert - Should work normally after restart (not paused)
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });
});