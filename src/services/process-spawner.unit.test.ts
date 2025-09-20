import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProcessSpawner, type SpawnConfig } from './process-spawner.js';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';

vi.mock('child_process');

// Factory for creating mock process with type safety
function createMockProcess(overrides: Partial<ChildProcess> = {}): ChildProcess {
  const emitter = new EventEmitter();

  return Object.assign(emitter, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: null,
    pid: 123,
    killed: false,
    exitCode: null,
    signalCode: null,
    spawnargs: [],
    spawnfile: '',
    kill: vi.fn().mockReturnValue(true),
    send: vi.fn().mockReturnValue(true),
    disconnect: vi.fn(),
    unref: vi.fn(),
    ref: vi.fn(),
    ...overrides
  }) as ChildProcess;
}

describe('ProcessSpawner', () => {
  let spawner: ProcessSpawner;

  beforeEach(() => {
    spawner = new ProcessSpawner();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('spawn', () => {
    it('should spawn process with correct configuration', () => {
      // Arrange
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      const config: SpawnConfig = {
        command: 'node',
        args: ['test.js'],
        cwd: '/test/dir',
        env: { FOO: 'bar' }
      };

      // Act
      const result = spawner.spawn(config);

      // Assert
      expect(spawn).toHaveBeenCalledWith(
        'node',
        ['test.js'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'inherit'],
          cwd: '/test/dir',
          env: expect.objectContaining({ FOO: 'bar' })
        })
      );
      expect(result).toBe(mockProcess);
    });

    it('should use default options when not specified', () => {
      // Arrange
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      const config: SpawnConfig = {
        command: 'node',
        args: ['test.js']
      };

      // Act
      spawner.spawn(config);

      // Assert
      expect(spawn).toHaveBeenCalledWith(
        'node',
        ['test.js'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'inherit'],
          cwd: undefined,
          env: process.env
        })
      );
    });

    it('should throw if stdin is not created', () => {
      // Arrange
      const mockProcess = createMockProcess({ stdin: null });
      vi.mocked(spawn).mockReturnValue(mockProcess);

      const config: SpawnConfig = {
        command: 'node',
        args: ['test.js']
      };

      // Act & Assert
      expect(() => spawner.spawn(config)).toThrow('Failed to create process streams');
    });

    it('should throw if stdout is not created', () => {
      // Arrange
      const mockProcess = createMockProcess({ stdout: null });
      vi.mocked(spawn).mockReturnValue(mockProcess);

      const config: SpawnConfig = {
        command: 'node',
        args: ['test.js']
      };

      // Act & Assert
      expect(() => spawner.spawn(config)).toThrow('Failed to create process streams');
    });

    it('should handle spawn errors', () => {
      // Arrange
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error('spawn ENOENT');
      });

      const config: SpawnConfig = {
        command: 'invalid-command',
        args: []
      };

      // Act & Assert
      expect(() => spawner.spawn(config)).toThrow('spawn ENOENT');
    });

    it('should merge environment variables', () => {
      // Arrange
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      const config: SpawnConfig = {
        command: 'node',
        args: ['test.js'],
        env: { CUSTOM: 'value' }
      };

      // Act
      spawner.spawn(config);

      // Assert
      expect(spawn).toHaveBeenCalledWith(
        'node',
        ['test.js'],
        expect.objectContaining({
          env: expect.objectContaining({
            ...process.env,
            CUSTOM: 'value'
          })
        })
      );
    });

    it('should validate both stdin and stdout are created', () => {
      // Arrange
      const mockProcess = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      const config: SpawnConfig = {
        command: 'node',
        args: ['test.js']
      };

      // Act
      const result = spawner.spawn(config);

      // Assert
      expect(result).toBe(mockProcess);
      expect(result.stdin).toBeDefined();
      expect(result.stdout).toBeDefined();
    });
  });
});