#!/usr/bin/env node

import { MCPHotReload } from './mcp-hot-reload.js';
import { ProxyConfig } from './types.js';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

// Load config from proxy.config.json if it exists
let config: ProxyConfig = {};
const configPath = path.join(process.cwd(), 'proxy.config.json');

if (existsSync(configPath)) {
  try {
    const configContent = readFileSync(configPath, 'utf-8');
    config = JSON.parse(configContent);
  } catch (error) {
    console.error('Error reading proxy.config.json:', error);
  }
}

// Override with command line arguments if provided
// Usage: mcp-hot-reload [serverCommand] [serverArgs...] [--watch pattern1,pattern2,...]
const args = process.argv.slice(2);
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

const proxy = new MCPHotReload(config);
proxy.start().catch(error => {
  console.error('Failed to start proxy:', error);
  process.exit(1);
});