import { ChildProcess } from 'child_process';
import { Readable, Writable } from 'stream';

/**
 * Represents a connection to a spawned MCP server process.
 * Provides access to stdio streams and crash detection.
 */
export interface ServerConnection {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly pid: number;

  /**
   * Returns a promise that resolves when the server process exits.
   * Can be awaited or used with .then() for async crash handling.
   */
  waitForCrash(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;

  /**
   * Check if the process is still running.
   */
  isAlive(): boolean;

  /**
   * Clean up event listeners and resources.
   * Should be called when the connection is no longer needed.
   */
  dispose(): void;
}

/**
 * Internal implementation of ServerConnection.
 * Wraps a child process and provides clean crash detection via promises.
 */
export class ServerConnectionImpl implements ServerConnection {
  private crashed = false;
  private crashPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private exitHandler?: () => void;

  constructor(
    public readonly stdin: Writable,
    public readonly stdout: Readable,
    public readonly pid: number,
    private process: ChildProcess
  ) {
    // Create promise that resolves on process exit
    this.crashPromise = new Promise((resolve) => {
      this.exitHandler = () => {
        this.crashed = true;
        const code = this.process.exitCode;
        const signal = this.process.signalCode;
        resolve({ code, signal });
      };

      // Use 'exit' event for crash detection
      // This fires when process ends, regardless of streams
      process.once('exit', this.exitHandler);
    });
  }

  waitForCrash(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return this.crashPromise;
  }

  isAlive(): boolean {
    // Process is alive if not crashed and no exit code set
    return !this.crashed && this.process.exitCode === null && !this.process.killed;
  }

  dispose(): void {
    if (this.exitHandler) {
      this.process.removeListener('exit', this.exitHandler);
      this.exitHandler = undefined;
    }
  }
}