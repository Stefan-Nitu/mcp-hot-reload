import { ChildProcess } from 'child_process';
import { createLogger } from '../utils/logger.js';
import { ProcessReadinessChecker } from './process-readiness-checker.js';
import { ProcessTerminator } from './process-terminator.js';
import { ProcessSpawner } from './process-spawner.js';

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
  private stopTerminator: ProcessTerminator;
  private restartTerminator: ProcessTerminator;
  private spawner: ProcessSpawner;

  constructor(
    config: McpServerConfig,
    readinessChecker: ProcessReadinessChecker,
    stopTerminator: ProcessTerminator,
    restartTerminator: ProcessTerminator,
    spawner: ProcessSpawner
  ) {
    this.config = config;
    this.readinessChecker = readinessChecker;
    this.stopTerminator = stopTerminator;
    this.restartTerminator = restartTerminator;
    this.spawner = spawner;
  }

  async start(): Promise<void> {
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

      // Handle unexpected exit (crash)
      childProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        if (this.currentProcess === childProcess) {
          // Unexpected exit - we didn't call stop()
          log.error({ code, signal }, 'Process crashed');
          this.currentProcess = null;
        }
      });

      // Handle process errors
      childProcess.on('error', (error: Error) => {
        log.error({ err: error }, 'Process error');
      });

      // Wait for process to be ready
      await this.readinessChecker.waitUntilReady(childProcess);
      log.info('Process ready');
    } catch (error) {
      log.error({ err: error }, 'Failed to start process');
      this.currentProcess = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.currentProcess) {
      return; // No process to stop
    }

    const childProcess = this.currentProcess;
    this.currentProcess = null; // Clear reference immediately to prevent exit handler

    await this.stopTerminator.terminate(childProcess);
  }

  private async stopForRestart(): Promise<void> {
    if (!this.currentProcess) {
      return; // No process to stop
    }

    const childProcess = this.currentProcess;
    this.currentProcess = null; // Clear reference immediately to prevent exit handler

    await this.restartTerminator.terminate(childProcess);
  }

  async restart(): Promise<void> {
    try {
      await this.stopForRestart();
      await this.start();
    } catch (error) {
      // Process couldn't be stopped (zombie), don't try to start a new one
      log.error({ err: error }, 'Cannot restart - process termination failed');
      throw error;
    }
  }

}