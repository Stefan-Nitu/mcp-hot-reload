import { describe, it, expect, beforeEach, vi, afterEach, Mock } from 'vitest';
import { FileWatcher } from '../file-watcher.js';
import chokidar from 'chokidar';

// Use vi.hoisted to define the mock watcher that will be returned by chokidar.watch
const { mockChokidarWatcher } = vi.hoisted(() => {
  const mockChokidarWatcher = {
    on: vi.fn(),
    close: vi.fn(),
    add: vi.fn(),
    unwatch: vi.fn()
  };

  // Make on() chainable by default
  mockChokidarWatcher.on.mockReturnValue(mockChokidarWatcher);

  return { mockChokidarWatcher };
});

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => mockChokidarWatcher)
  }
}));

describe('FileWatcher', () => {
  let watcher: FileWatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset mock to be chainable for each test
    mockChokidarWatcher.on.mockReturnValue(mockChokidarWatcher);
  });

  afterEach(() => {
    if (watcher) {
      watcher.stop();
    }
    vi.useRealTimers();
  });

  describe('Basic Operations', () => {
    it('should start watching specified patterns', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
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
      });
      watcher.start();

      // Act
      watcher.stop();

      // Assert
      expect(mockChokidarWatcher.close).toHaveBeenCalled();
    });
  });

  describe('Change Detection', () => {
    it('should resolve waitForChange when file changes', async () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - Set up promise before triggering change
      const changePromise = watcher.waitForChange();
      changeHandler?.('src/index.ts');
      vi.runAllTimers();

      // Assert
      const changedFiles = await changePromise;
      expect(changedFiles).toContain('src/index.ts');
    });

    it('should filter by file extensions when no glob pattern', async () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        debounceMs: 10,  // Small debounce for testing
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - TypeScript file should trigger
      const changePromise = watcher.waitForChange();
      changeHandler?.('src/index.ts');
      vi.advanceTimersByTime(10);

      // Assert
      const changedFiles = await changePromise;
      expect(changedFiles).toContain('src/index.ts');

      // Act - README should not trigger
      const changePromise2 = watcher.waitForChange();
      changeHandler?.('src/README.md');

      // Promise should not resolve immediately
      let resolved = false;
      changePromise2.then(() => { resolved = true; });
      vi.advanceTimersByTime(10);
      await Promise.resolve();
      expect(resolved).toBe(false);

      // But should resolve when a valid file changes
      changeHandler?.('src/valid.ts');
      vi.advanceTimersByTime(10);
      const changedFiles2 = await changePromise2;
      expect(changedFiles2).toEqual(['src/valid.ts']);
    });

    it('should respect glob patterns', async () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: 'src/**/*.ts',
        debounceMs: 10,  // Small debounce for testing
        cwd: '/test'  // Set a known cwd for testing
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - .ts file should trigger (use absolute paths)
      const changePromise = watcher.waitForChange();
      changeHandler?.('/test/src/index.ts');
      vi.advanceTimersByTime(10);

      // Assert
      const changedFiles = await changePromise;
      expect(changedFiles).toContain('/test/src/index.ts');

      // Act - .js file should not trigger
      const changePromise2 = watcher.waitForChange();
      changeHandler?.('/test/src/index.js');

      // Promise should not resolve for non-matching file
      let resolved = false;
      changePromise2.then(() => { resolved = true; });
      vi.advanceTimersByTime(10);
      await Promise.resolve();
      expect(resolved).toBe(false);

      // But should resolve when a matching file changes
      changeHandler?.('/test/src/app.ts');
      vi.advanceTimersByTime(10);
      const changedFiles2 = await changePromise2;
      expect(changedFiles2).toEqual(['/test/src/app.ts']);
    });
  });

  describe('Debouncing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should debounce rapid changes', async () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        debounceMs: 100,
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - Set up promise and trigger multiple rapid changes
      const changePromise = watcher.waitForChange();
      changeHandler?.('src/file1.ts');
      changeHandler?.('src/file2.ts');
      changeHandler?.('src/file3.ts');

      // Assert - Promise should not resolve immediately
      let resolved = false;
      changePromise.then(() => { resolved = true; });
      await Promise.resolve(); // Let any immediate promises settle
      expect(resolved).toBe(false);

      // Act - Advance timers
      vi.advanceTimersByTime(100);

      // Assert - Promise resolves with all changed files after debounce
      const changedFiles = await changePromise;
      expect(changedFiles).toEqual(['src/file1.ts', 'src/file2.ts', 'src/file3.ts']);
    });

    it('should reset debounce timer on new changes', async () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        debounceMs: 100,
      });
      watcher.start();
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - Set up promise and trigger changes with timer resets
      const changePromise = watcher.waitForChange();
      let resolved = false;
      changePromise.then(() => { resolved = true; });

      changeHandler?.('src/file1.ts');
      vi.advanceTimersByTime(50);
      expect(resolved).toBe(false); // Still not resolved

      changeHandler?.('src/file2.ts');
      vi.advanceTimersByTime(50);
      expect(resolved).toBe(false); // Still not resolved

      changeHandler?.('src/file3.ts');
      vi.advanceTimersByTime(50);
      expect(resolved).toBe(false); // Still not resolved (timer kept resetting)

      // Act - Wait for full debounce period
      vi.advanceTimersByTime(50);

      // Assert - Now it should resolve with all files
      const changedFiles = await changePromise;
      expect(changedFiles).toEqual(['src/file1.ts', 'src/file2.ts', 'src/file3.ts']);
    });
  });

  describe('Error Handling', () => {
    it('should continue watching after chokidar errors without throwing', async () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
      });
      watcher.start();
      const errorHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'error'
      )?.[1] as ((error: Error) => void) | undefined;
      const changeHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - Set up promise and simulate chokidar error
      const changePromise = watcher.waitForChange();
      const mockError = new Error('ENOENT: no such file or directory');
      errorHandler?.(mockError);

      // Assert - Should not throw or crash, error should be logged
      expect(() => errorHandler?.(mockError)).not.toThrow();

      // Act - Trigger a valid change after error
      changeHandler?.('src/file.ts');
      vi.runAllTimers();

      // Assert - Watcher should still work after error
      const changedFiles = await changePromise;
      expect(changedFiles).toContain('src/file.ts');
    });
  });

  describe('Edge Cases', () => {
    it('should not start watching when already started', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
      });
      watcher.start();
      const firstCallCount = (chokidar.watch as Mock).mock.calls.length;

      // Act - Try to start again
      watcher.start();

      // Assert - chokidar.watch should not be called again
      expect((chokidar.watch as Mock).mock.calls.length).toBe(firstCallCount);
    });

    it('should not throw when stopping without starting', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
      });

      // Act & Assert - Should not throw when stopping without starting
      expect(() => watcher.stop()).not.toThrow();
      expect(mockChokidarWatcher.close).not.toHaveBeenCalled();
    });

    it('should not start watching when patterns array is empty', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: [],
      });

      // Act
      watcher.start();

      // Assert - Should not call chokidar.watch with empty targets
      expect(chokidar.watch).not.toHaveBeenCalled();
    });
  });

  describe('File Event Types', () => {
    it('should handle add event for new files', async () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        debounceMs: 10,
      });
      watcher.start();
      const addHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'add'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - Set up promise and simulate 'add' event
      const changePromise = watcher.waitForChange();
      addHandler?.('src/new-file.ts');
      vi.advanceTimersByTime(10);

      // Assert - Promise should resolve with the new file
      const changedFiles = await changePromise;
      expect(changedFiles).toContain('src/new-file.ts');
    });

    it('should filter add events by file extensions', async () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        debounceMs: 10,
      });
      watcher.start();
      const addHandler = mockChokidarWatcher.on.mock.calls.find(
        call => call[0] === 'add'
      )?.[1] as ((path: string) => void) | undefined;

      // Act - Add TypeScript file (should trigger)
      const changePromise = watcher.waitForChange();
      addHandler?.('src/new-file.ts');
      vi.advanceTimersByTime(10);

      // Assert
      const changedFiles = await changePromise;
      expect(changedFiles).toContain('src/new-file.ts');

      // Act - Add non-source file (should not trigger)
      const changePromise2 = watcher.waitForChange();
      addHandler?.('src/README.md');

      // Promise should not resolve for non-matching extension
      let resolved = false;
      changePromise2.then(() => { resolved = true; });
      vi.advanceTimersByTime(10);
      await Promise.resolve();
      expect(resolved).toBe(false);

      // But should resolve when a valid file is added
      addHandler?.('src/another.ts');
      vi.advanceTimersByTime(10);
      const changedFiles2 = await changePromise2;
      expect(changedFiles2).toEqual(['src/another.ts']);
    });
  });
});