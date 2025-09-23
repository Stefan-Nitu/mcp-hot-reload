#!/usr/bin/env node

/**
 * Test server that crashes with specific exit code when receiving a 'crash' method.
 * Responds normally to initialize.
 */

import { createInterface } from 'readline';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);

    if (msg.method === 'initialize') {
      console.log(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'crash-test', version: '1.0.0' }
        }
      }));
    } else if (msg.method === 'crash') {
      // Exit with specific code to simulate crash
      process.exit(42);
    }
  } catch (e) {
    // Ignore parse errors
  }
});