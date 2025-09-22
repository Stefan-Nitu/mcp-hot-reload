import { PassThrough } from 'stream';
import { expect } from 'vitest';
import { writeFileSync } from 'fs';

// Timing constants for test harness
const WAIT_FOR_RESPONSE = 500;    // Default time to wait for RPC response
const POLL_INTERVAL = 50;          // Interval for polling responses
const POLL_TIMEOUT = 100;          // Polling interval for expect.poll
const INIT_TIMEOUT = 5000;         // Timeout for server initialization
const RESTART_TIMEOUT = 10000;     // Default timeout for restart detection
const RESPONSE_TIMEOUT = 1000;     // Default timeout for waitForResponse

/**
 * Test harness for MCP proxy integration tests.
 * Tracks server behaviors through protocol messages only.
 */
export class MCPTestHarness {
  private initializeResponses: any[] = [];
  private allMessages: any[] = [];
  private restartCount = 0;
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
          }

          // Track notification messages - this is the clear signal of a restart
          if (msg.method === 'notifications/tools/list_changed') {
            this.restartCount++;
            console.error('[HARNESS] Detected restart notification, count:', this.restartCount);
          }
        } catch (e) {
          // Not JSON, ignore
        }
      });
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

    // Wait for initialize response
    await expect.poll(() => this.serverReady, {
      interval: POLL_TIMEOUT,
      timeout: INIT_TIMEOUT
    }).toBe(true);
  }

  /**
   * Wait for a specific number of restarts
   */
  async waitForRestarts(count: number, timeout = RESTART_TIMEOUT) {
    await expect.poll(() => this.restartCount, {
      interval: POLL_TIMEOUT,
      timeout
    }).toBeGreaterThanOrEqual(count);
  }


  /**
   * Get counts for assertions
   */
  getCounts() {
    return {
      initializeResponses: this.initializeResponses.length,
      restarts: this.restartCount,
      messages: this.allMessages.length,
      serverReady: this.serverReady
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
   * Send a tool call request and optionally wait for response
   */
  async callTool(name: string, args?: any, requestId?: number) {
    const id = requestId ?? Date.now();
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args }
    }) + '\n';

    this.clientIn.write(request);

    // Wait a bit for the response to arrive
    await new Promise(resolve => setTimeout(resolve, WAIT_FOR_RESPONSE));

    // Find and return the response
    return this.allMessages.find(msg => msg.id === id);
  }

  /**
   * Send a tools/list request and wait for response
   */
  async listTools(requestId?: number) {
    const id = requestId ?? Date.now();
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/list'
    }) + '\n';

    this.clientIn.write(request);

    // Wait a bit for the response to arrive
    await new Promise(resolve => setTimeout(resolve, WAIT_FOR_RESPONSE));

    // Find and return the response
    return this.allMessages.find(msg => msg.id === id);
  }

  /**
   * Send a raw JSON-RPC request
   */
  sendRequest(method: string, params?: any, id?: number) {
    const requestId = id ?? Date.now();
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method,
      params
    }) + '\n';

    this.clientIn.write(request);
    return requestId;
  }

  /**
   * Wait for a response with a specific ID
   */
  async waitForResponse(id: number, timeout = RESPONSE_TIMEOUT): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const response = this.allMessages.find(msg => msg.id === id);
      if (response) {
        return response;
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
    return null;
  }

  /**
   * Get the latest response (useful for tests that send only one request)
   */
  getLatestResponse() {
    const responses = this.allMessages.filter(msg => msg.id && msg.result);
    return responses[responses.length - 1];
  }

  /**
   * Create a new file (triggers 'add' event in file watcher).
   */
  writeFile(filePath: string, content: string) {
    writeFileSync(filePath, content);
  }

  /**
   * Modify an existing file (triggers 'change' event in file watcher).
   */
  changeFile(filePath: string, content: string) {
    writeFileSync(filePath, content);
  }

/**
   * Wait for a specific duration (makes test timings explicit)
   */
  async wait(ms: number) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }


}