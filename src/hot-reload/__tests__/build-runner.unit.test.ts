import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BuildRunner } from '../build-runner.js';
import * as child_process from 'child_process';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';

vi.mock('child_process');
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

describe('BuildRunner', () => {
  let mockProcess: ChildProcess;

  function createMockChildProcess(): ChildProcess {
    const emitter = new EventEmitter();
    const stdout = new EventEmitter() as EventEmitter & Readable;
    const stderr = new EventEmitter() as EventEmitter & Readable;
    const stdin = new EventEmitter() as EventEmitter & Writable;

    const mockKill = vi.fn().mockReturnValue(true);

    const process = Object.assign(emitter, {
      stdout,
      stderr,
      stdin,
      stdio: [stdin, stdout, stderr, null, null] as unknown as ChildProcess['stdio'],
      pid: 12345,
      connected: false,
      exitCode: null,
      signalCode: null,
      spawnargs: [],
      spawnfile: '',
      killed: false,
      kill: mockKill,
      send: vi.fn().mockReturnValue(false),
      disconnect: vi.fn(),
      unref: vi.fn().mockReturnThis(),
      ref: vi.fn().mockReturnThis(),
      [Symbol.dispose]: vi.fn()
    }) as ChildProcess;

    return process;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess = createMockChildProcess();
  });

  it('returns true when build succeeds', async () => {
    // Arrange
    const spawnMock = vi.mocked(child_process.spawn);
    spawnMock.mockReturnValue(mockProcess);
    const buildRunner = new BuildRunner('npm run build', '/project');

    // Act
    const buildPromise = buildRunner.run();
    mockProcess.emit('exit', 0, null);
    const result = await buildPromise;

    // Assert - Test behavior: build success returns true
    expect(result).toBe(true);
  });

  it('returns false when build fails', async () => {
    // Arrange
    const spawnMock = vi.mocked(child_process.spawn);
    spawnMock.mockReturnValue(mockProcess);
    const buildRunner = new BuildRunner('npm run build', '/project');

    // Act
    const buildPromise = buildRunner.run();
    mockProcess.emit('exit', 1, null);
    const result = await buildPromise;

    // Assert
    expect(result).toBe(false);
  });

  it('returns true when no command provided', async () => {
    // Arrange
    const spawnMock = vi.mocked(child_process.spawn);
    const buildRunner = new BuildRunner('', '/project');

    // Act
    const result = await buildRunner.run();

    // Assert
    expect(spawnMock).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('returns true for whitespace-only command', async () => {
    // Arrange
    const spawnMock = vi.mocked(child_process.spawn);
    const buildRunner = new BuildRunner('   ', '/project');

    // Act
    const result = await buildRunner.run();

    // Assert
    expect(spawnMock).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('cancels build when new build is requested', async () => {
    // Arrange
    const spawnMock = vi.mocked(child_process.spawn);
    const firstProcess = createMockChildProcess();
    const secondProcess = createMockChildProcess();
    spawnMock.mockReturnValueOnce(firstProcess).mockReturnValueOnce(secondProcess);
    const buildRunner = new BuildRunner('npm run build', '/project');

    // Act - Start first build
    const firstBuildPromise = buildRunner.run();

    // Start second build immediately (should cancel first)
    const secondBuildPromise = buildRunner.run();

    // Simulate first process being killed
    firstProcess.emit('exit', null, 'SIGTERM');
    // Simulate second process completing
    secondProcess.emit('exit', 0, null);

    await firstBuildPromise;
    const result = await secondBuildPromise;

    // Assert
    expect(firstProcess.kill).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('should cancel running build when cancel() is called', async () => {
    // Arrange
    const spawnMock = vi.mocked(child_process.spawn);
    spawnMock.mockReturnValue(mockProcess);
    const buildRunner = new BuildRunner('npm run build', '/project');

    // Act
    const buildPromise = buildRunner.run();

    // Cancel after a short delay
    setTimeout(() => {
      buildRunner.cancel();
      // Simulate process exit after kill
      mockProcess.emit('exit', null, 'SIGTERM');
    }, 10);

    const result = await buildPromise;

    // Assert
    expect(mockProcess.kill).toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('should handle cancel when no build is running', () => {
    // Arrange
    const buildRunner = new BuildRunner('npm run build', '/project');

    // Act & Assert - Should not throw
    expect(() => buildRunner.cancel()).not.toThrow();
  });
});