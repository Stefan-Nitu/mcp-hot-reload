import { ChildProcess } from 'child_process';
import { Readable, Writable } from 'stream';
import { createLogger } from '../utils/logger.js';
import { ProcessReadinessChecker } from './readiness-checker.js';
import { ProcessTerminator } from './terminator.js';
import { ProcessSpawner } from './spawner.js';
import { ServerConnection, ServerConnectionImpl } from './server-connection.js';

const log = createLogger('mcp-server-lifecycle');

export interface McpServerConfig {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export class McpServerLifecycle {
  private config: McpServerConfig;
  private currentProcess: ChildProcess | null = null;
  private readinessChecker: ProcessReadinessChecker;
  private restartTerminator: ProcessTerminator;
  private spawner: ProcessSpawner;

  constructor(
    config: McpServerConfig,
    readinessChecker: ProcessReadinessChecker,
    restartTerminator: ProcessTerminator,
    spawner: ProcessSpawner
  ) {
    this.config = config;
    this.readinessChecker = readinessChecker;
    this.restartTerminator = restartTerminator;
    this.spawner = spawner;
  }

  async start(): Promise<ServerConnection> {
    if (this.currentProcess) {
      throw new Error('MCP server is already running');
    }

    log.info({ command: this.config.command, args: this.config.args }, 'Starting process');

    try {
      const childProcess = this.spawner.spawn({
        command: this.config.command,
        args: this.config.args,
        cwd: this.config.cwd,
        env: this.config.env
      });

      this.currentProcess = childProcess;

      // Handle unexpected exit (crash) for internal tracking only
      childProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        if (this.currentProcess === childProcess) {
          // Unexpected exit - we didn't call stop()
          log.error({ code, signal }, 'Process crashed');
          this.currentProcess = null;
        }
      });

      // Wait for process to be ready
      await this.readinessChecker.waitUntilReady(childProcess);
      log.info('Process ready');

      // Return ServerConnection for clean crash handling
      return new ServerConnectionImpl(
        childProcess.stdin!,
        childProcess.stdout!,
        childProcess.pid!,
        childProcess
      );
    } catch (error) {
      log.error({ err: error }, 'Failed to start process');
      this.currentProcess = null;
      throw error;
    }
  }

  private async stopForRestart(): Promise<void> {
    if (!this.currentProcess) {
      return; // No process to stop
    }

    const childProcess = this.currentProcess;
    this.currentProcess = null; // Clear reference immediately to prevent exit handler

    await this.restartTerminator.terminate(childProcess);
  }

  async restart(): Promise<ServerConnection> {
    try {
      await this.stopForRestart();
      return await this.start();
    } catch (error) {
      // Process couldn't be stopped (zombie), don't try to start a new one
      log.error({ err: error }, 'Cannot restart - process termination failed');
      throw error;
    }
  }

  getStreams(): { stdin: Writable; stdout: Readable } | null {
    if (!this.currentProcess || !this.currentProcess.stdin || !this.currentProcess.stdout) {
      return null;
    }

    return {
      stdin: this.currentProcess.stdin,
      stdout: this.currentProcess.stdout
    };
  }
}