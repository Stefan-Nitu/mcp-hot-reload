#!/usr/bin/env node

// Server that crashes after responding to initialize
process.stdin.once('data', (data) => {
  const msg = JSON.parse(data.toString().trim());
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: { protocolVersion: 'test', capabilities: {} }
    }) + '\n');
    // Crash after responding
    setTimeout(() => process.exit(1), 100);
  }
});