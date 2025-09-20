import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FileWatcher } from './file-watcher.js';
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
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset mock to be chainable for each test
    mockChokidarWatcher.on.mockReturnValue(mockChokidarWatcher);

    onChange = vi.fn();
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

  describe('Debouncing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

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
      vi.advanceTimersByTime(100);

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
      vi.advanceTimersByTime(50);
      changeHandler?.('src/file2.ts');
      vi.advanceTimersByTime(50);
      changeHandler?.('src/file3.ts');
      vi.advanceTimersByTime(50);

      // Assert - Still not called (timer kept resetting)
      expect(onChange).not.toHaveBeenCalled();

      // Act - Wait for full debounce period
      vi.advanceTimersByTime(50);

      // Assert - Now it should be called
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    it('should continue watching after chokidar errors without throwing', () => {
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
      const firstCallCount = (chokidar.watch as vi.Mock).mock.calls.length;

      // Act - Try to start again
      watcher.start();

      // Assert - chokidar.watch should not be called again
      expect((chokidar.watch as vi.Mock).mock.calls.length).toBe(firstCallCount);
    });

    it('should not throw when stopping without starting', () => {
      // Arrange
      watcher = new FileWatcher({
        patterns: './src',
        onChange
      });

      // Act & Assert - Should not throw when stopping without starting
      expect(() => watcher.stop()).not.toThrow();
      expect(mockChokidarWatcher.close).not.toHaveBeenCalled();
    });

    it('should not start watching when patterns array is empty', () => {
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
});