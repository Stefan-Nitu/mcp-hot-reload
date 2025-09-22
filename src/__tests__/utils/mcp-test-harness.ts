import { PassThrough } from 'stream';
import { expect } from 'vitest';

/**
 * Test harness for MCP proxy integration tests.
 * Tracks server behaviors and provides semantic waiting methods.
 */
export class MCPTestHarness {
  private initializeResponses: any[] = [];
  private allMessages: any[] = [];
  private stderrLogs: string[] = [];
  private restartCount = 0;
  private fileChangeDetected = false;
  private buildStarted = false;
  private buildCompleted = false;
  private serverReady = false;

  constructor(
    public readonly clientIn: PassThrough,
    public readonly clientOut: PassThrough
  ) {
    this.setupTracking();
  }

  private setupTracking() {
    // Track all messages from server
    this.clientOut.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter((line: string) => line.trim());
      lines.forEach((line: string) => {
        try {
          const msg = JSON.parse(line);
          this.allMessages.push(msg);

          // Track initialize responses specifically
          if (msg.id === 1 && msg.result?.protocolVersion) {
            this.initializeResponses.push(msg);
            this.serverReady = true;
            if (this.initializeResponses.length > 1) {
              this.restartCount++;
            }
          }

          // Track notification messages
          if (msg.method === 'notifications/tools/list_changed') {
            // This indicates a restart is happening
          }
        } catch (e) {
          // Not JSON, ignore
        }
      });
    });
  }

  /**
   * Track stderr output for detecting internal state changes
   */
  trackStderr(stderr: PassThrough) {
    stderr.on('data', (chunk) => {
      const output = chunk.toString();
      this.stderrLogs.push(output);

      // Parse common log patterns
      if (output.includes('File change detected')) {
        this.fileChangeDetected = true;
      }
      if (output.includes('starting build')) {
        this.buildStarted = true;
      }
      if (output.includes('Build succeeded')) {
        this.buildCompleted = true;
      }
      if (output.includes('Process ready')) {
        this.serverReady = true;
      }
      if (output.includes('Re-sending initialize request')) {
        // Restart is happening
      }
    });
  }

  /**
   * Send initialize request and wait for server to be ready
   */
  async initialize() {
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {}
    }) + '\n';

    this.clientIn.write(initRequest);

    // Wait for server to respond
    await this.waitForServerReady();
  }

  /**
   * Wait for server to be ready (responded to initialize)
   */
  async waitForServerReady(timeout = 5000) {
    await expect.poll(() => this.serverReady, {
      interval: 100,
      timeout
    }).toBe(true);
  }

  /**
   * Wait for a specific number of restarts to complete
   */
  async waitForRestarts(count: number, timeout = 5000) {
    await expect.poll(() => this.restartCount, {
      interval: 100,
      timeout
    }).toBeGreaterThanOrEqual(count);
  }

  /**
   * Wait and verify that restart count remains at expected value (no unexpected restarts)
   */
  async expectNoMoreRestarts(expectedCount: number, waitTime = 1000) {
    const startCount = this.restartCount;
    await new Promise(resolve => setTimeout(resolve, waitTime));
    expect(this.restartCount).toBe(expectedCount);
  }

  /**
   * Wait for file change to be detected
   */
  async waitForFileChangeDetection(timeout = 5000) {
    await expect.poll(() => this.fileChangeDetected, {
      interval: 100,
      timeout
    }).toBe(true);
    // Reset for next detection
    this.fileChangeDetected = false;
  }

  /**
   * Wait for build to complete
   */
  async waitForBuildComplete(timeout = 5000) {
    await expect.poll(() => this.buildCompleted, {
      interval: 100,
      timeout
    }).toBe(true);
    // Reset for next build
    this.buildCompleted = false;
  }

  /**
   * Get counts for assertions
   */
  getCounts() {
    return {
      initializeResponses: this.initializeResponses.length,
      restarts: this.restartCount,
      totalMessages: this.allMessages.length,
      stderrLogs: this.stderrLogs.length
    };
  }

  /**
   * Get all initialize responses for detailed assertions
   */
  getInitializeResponses() {
    return this.initializeResponses;
  }

  /**
   * Get all messages for debugging
   */
  getAllMessages() {
    return this.allMessages;
  }

  /**
   * Reset tracking state (useful between test phases)
   */
  resetTracking() {
    this.fileChangeDetected = false;
    this.buildStarted = false;
    this.buildCompleted = false;
  }
}