#!/usr/bin/env node

/**
 * MCP Hot Reload - Entry point
 *
 * Architecture:
 *   MCP Client (e.g., Claude, IDE) spawns this proxy
 *   ↓
 *   mcp-hot-reload (transparent proxy)
 *   ↓
 *   MCP Server (user's implementation)
 *
 * This proxy intercepts the communication, preserves sessions during
 * server restarts, and handles automatic rebuilding on file changes.
 */

import { MCPProxy } from './mcp-proxy.js';
import { ProxyConfig } from './types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';

const log = createLogger('index');

// Get package.json for version
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version;

function showHelp(): void {
  console.log(`
mcp-hot-reload v${VERSION}

Hot-reload development tool for MCP (Model Context Protocol) servers with session preservation.

Usage:
  mcp-hot-reload [options] [serverCommand] [serverArgs...] [--watch patterns]

Options:
  --help, -h        Show this help message
  --version, -v     Show version number
  --init            Create a hot-reload.config.json with default settings
  --watch <patterns> Comma-separated glob patterns to watch (e.g., src/**/*.ts,lib/**/*.js)

Examples:
  # Using hot-reload.config.json in current directory
  mcp-hot-reload

  # Explicit command with watch patterns
  mcp-hot-reload node dist/index.js --watch src/**/*.ts

  # Watch multiple patterns
  mcp-hot-reload node dist/server.js --watch "src/**/*.ts,lib/**/*.js"

Configuration:
  Create a hot-reload.config.json file for persistent settings:
  {
    "serverCommand": "node",
    "serverArgs": ["dist/index.js"],
    "buildCommand": "npm run build",
    "watchPattern": ["./src"],
    "debounceMs": 300
  }

For more info: https://github.com/Stefan-Nitu/mcp-hot-reload
`);
}

// Check for help, version, and init flags
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

if (args.includes('--init')) {
  const configPath = path.join(process.cwd(), 'hot-reload.config.json');
  if (existsSync(configPath)) {
    console.error('hot-reload.config.json already exists!');
    process.exit(1);
  }

  const defaultConfig = {
    serverCommand: 'node',
    serverArgs: ['dist/index.js'],
    buildCommand: 'npm run build',
    watchPattern: ['./src'],
    debounceMs: 300
  };

  try {
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n');
    console.log('✅ Created hot-reload.config.json with default settings');
    console.log('\nNext steps:');
    console.log('1. Edit hot-reload.config.json if needed');
    console.log('2. Run: mcp-hot-reload');
  } catch (error) {
    console.error('Failed to create config file:', error);
    process.exit(1);
  }
  process.exit(0);
}

// Load config from hot-reload.config.json (or legacy proxy.config.json)
let config: ProxyConfig = {};
const hotReloadConfigPath = path.join(process.cwd(), 'hot-reload.config.json');
const legacyConfigPath = path.join(process.cwd(), 'proxy.config.json');

// Prefer hot-reload.config.json, fall back to proxy.config.json for backwards compatibility
const configPath = existsSync(hotReloadConfigPath) ? hotReloadConfigPath : legacyConfigPath;

if (existsSync(configPath)) {
  try {
    const configContent = readFileSync(configPath, 'utf-8');
    config = JSON.parse(configContent);
    log.debug({ configFile: path.basename(configPath) }, 'Loaded configuration');
  } catch (error) {
    log.warn({ err: error, configFile: path.basename(configPath) }, 'Could not read config file, using defaults');
  }
}

// Override with command line arguments if provided
// Usage: mcp-hot-reload [serverCommand] [serverArgs...] [--watch pattern1,pattern2,...]
if (args.length > 0) {
  // Check for --watch flag
  const watchIndex = args.indexOf('--watch');
  let serverArgs = args;

  if (watchIndex !== -1) {
    // Extract watch patterns after --watch
    const watchPatterns = args[watchIndex + 1];
    if (watchPatterns) {
      config.watchPattern = watchPatterns.split(',');
    }
    // Remove --watch and its value from args
    serverArgs = args.slice(0, watchIndex).concat(args.slice(watchIndex + 2));
  }

  // Use remaining args as server command
  if (serverArgs.length > 0) {
    config.serverCommand = serverArgs[0];
    config.serverArgs = serverArgs.slice(1);
  }
}

// Setup stdin end handler at the top level for reliability
// This ensures the process exits when stdin is closed
process.stdin.on('end', () => {
  process.exit(0);
});

const proxy = new MCPProxy(config);
proxy.start().catch(error => {
  log.error({ err: error }, 'Failed to start proxy');
  process.exit(1);
});