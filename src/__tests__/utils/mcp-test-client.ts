import { spawn, ChildProcess } from 'child_process';

export interface TestClientOptions {
  proxyPath: string;
  serverCommand: string;
  serverArgs?: string[];
  cwd?: string;
}

export class MCPTestClient {
  private proxyProcess: ChildProcess | null = null;
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;

  async start(options: TestClientOptions): Promise<void> {
    const { proxyPath, serverCommand, serverArgs = [], cwd = process.cwd() } = options;

    // Spawn the proxy process as an MCP client would
    this.proxyProcess = spawn('node', [
      proxyPath,
      serverCommand,
      ...serverArgs
    ], {
      stdio: 'pipe',
      cwd
    });

    // Track exit
    this.proxyProcess.on('exit', (code, signal) => {
      this.exitCode = code;
      this.exitSignal = signal;
    });

    // Wait a bit for startup
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  sendSignal(signal: NodeJS.Signals): void {
    if (!this.proxyProcess) {
      throw new Error('Proxy not started');
    }
    this.proxyProcess.kill(signal);
  }

  async waitForExit(timeout = 1000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    if (!this.proxyProcess) {
      throw new Error('Proxy not started');
    }

    await Promise.race([
      new Promise<void>(resolve => {
        this.proxyProcess!.once('exit', () => resolve());
      }),
      new Promise(resolve => setTimeout(resolve, timeout))
    ]);

    return {
      code: this.exitCode,
      signal: this.exitSignal
    };
  }

  isRunning(): boolean {
    return this.proxyProcess !== null && !this.proxyProcess.killed;
  }

  getStdout(): NodeJS.ReadableStream | null {
    return this.proxyProcess?.stdout || null;
  }

  getStderr(): NodeJS.ReadableStream | null {
    return this.proxyProcess?.stderr || null;
  }

  getStdin(): NodeJS.WritableStream | null {
    return this.proxyProcess?.stdin || null;
  }

  cleanup(): void {
    if (this.proxyProcess && !this.proxyProcess.killed) {
      this.proxyProcess.kill('SIGKILL');
    }
  }
}