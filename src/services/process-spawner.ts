import { ChildProcess, spawn, SpawnOptions } from 'child_process';
import { createLogger } from '../utils/logger.js';

const log = createLogger('process-spawner');

export interface SpawnConfig {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export class ProcessSpawner {
  spawn(config: SpawnConfig): ChildProcess {
    log.info({ command: config.command, args: config.args }, 'Starting process');

    const spawnOptions: SpawnOptions = {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: config.cwd,
      env: { ...process.env, ...config.env }
    };

    const childProcess = spawn(config.command, config.args, spawnOptions);

    if (!childProcess.stdout || !childProcess.stdin) {
      throw new Error('Failed to create process streams');
    }

    // Log process errors but don't crash
    childProcess.on('error', (error) => {
      log.error({ err: error }, 'Process error');
    });

    return childProcess;
  }
}