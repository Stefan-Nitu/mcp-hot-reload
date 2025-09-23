import { Readable, Writable } from 'stream';
import { ProtocolHandler } from '../protocol/protocol-handler.js';
import { BuildRunner } from '../hot-reload/build-runner.js';
import { FileWatcher } from '../hot-reload/file-watcher.js';
import { HotReload } from '../hot-reload/hot-reload.js';
import { McpServerLifecycle } from '../process/lifecycle.js';
import { ProcessSpawner } from '../process/spawner.js';
import { ProcessTerminator } from '../process/terminator.js';
import { ProcessReadinessChecker } from '../process/readiness-checker.js';
import { ProxyConfig } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { MCPProxy } from '../mcp-proxy.js';

const log = createLogger('mcp-proxy-factory');

export interface MCPProxyDependencies {
  protocolHandler: ProtocolHandler;
  serverLifecycle: McpServerLifecycle;
  hotReload: HotReload;
  config: Required<ProxyConfig>;
}

/**
 * Factory for creating MCPProxy and its dependencies.
 * Follows dependency injection pattern - objects don't instantiate other objects.
 */
export class MCPProxyFactory {
  static create(
    config: ProxyConfig = {},
    stdin: Readable = process.stdin,
    stdout: Writable = process.stdout
  ): MCPProxy {
    // Build normalized config
    const normalizedConfig = this.normalizeConfig(config);

    // Create all dependencies
    const protocolHandler = this.createProtocolHandler(stdin, stdout);
    const serverLifecycle = this.createServerLifecycle(normalizedConfig);
    const hotReload = this.createHotReload(normalizedConfig);

    // Create proxy with injected dependencies
    return new MCPProxy(
      protocolHandler,
      serverLifecycle,
      hotReload,
      normalizedConfig,
      stdin,
      stdout
    );
  }

  private static normalizeConfig(config: ProxyConfig): Required<ProxyConfig> {
    // Support both new names and deprecated aliases
    const mcpServerCommand = config.mcpServerCommand || config.serverCommand || 'node';
    const mcpServerArgs = config.mcpServerArgs || config.serverArgs || ['dist/index.js'];

    return {
      buildCommand: config.buildCommand || 'npm run build',
      watchPattern: config.watchPattern || './src',
      debounceMs: config.debounceMs || 300,
      mcpServerCommand,
      mcpServerArgs,
      serverCommand: mcpServerCommand,  // Keep for internal compatibility
      serverArgs: mcpServerArgs,        // Keep for internal compatibility
      cwd: config.cwd || process.cwd(),
      env: config.env || {},
      onExit: config.onExit || ((code) => process.exit(code))
    };
  }

  private static createProtocolHandler(
    stdin: Readable,
    stdout: Writable
  ): ProtocolHandler {
    return new ProtocolHandler(stdin, stdout);
  }

  private static createServerLifecycle(config: Required<ProxyConfig>): McpServerLifecycle {
    // Create process management dependencies
    const spawner = new ProcessSpawner();

    const readinessChecker = new ProcessReadinessChecker({
      checkIntervalMs: 50,
      timeoutMs: 2000,
      settleDelayMs: 100
    });

    const restartTerminator = new ProcessTerminator({
      closeStdin: false,
      gracePeriodMs: 0,
      forcePeriodMs: 100,
      zombieTimeoutMs: 500,
      throwOnZombie: true
    });

    return new McpServerLifecycle(
      {
        command: config.mcpServerCommand,
        args: config.mcpServerArgs,
        cwd: config.cwd,
        env: {
          ...process.env,
          ...config.env,
          MCP_PROXY_INSTANCE: `mcp-proxy-${process.pid}-${Date.now()}`
        }
      },
      readinessChecker,
      restartTerminator,
      spawner
    );
  }

  private static createHotReload(config: Required<ProxyConfig>): HotReload {
    if (!config.buildCommand || !config.buildCommand.trim()) {
      log.warn('No build command configured. Server will restart on file changes without building.');
    } else {
      log.info(`Build command: ${config.buildCommand}`);
    }

    const buildRunner = new BuildRunner(config.buildCommand, config.cwd);
    const fileWatcher = new FileWatcher({
      patterns: config.watchPattern,
      cwd: config.cwd,
      debounceMs: config.debounceMs
    });

    return new HotReload(buildRunner, fileWatcher);
  }
}