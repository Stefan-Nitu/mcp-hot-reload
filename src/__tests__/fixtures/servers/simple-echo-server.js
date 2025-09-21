#!/usr/bin/env node

// Simple echo server that responds to initialize and keeps running
process.stdin.on('data', (data) => {
  const messages = data.toString().split('\n').filter(line => line.trim());
  messages.forEach(line => {
    try {
      const msg = JSON.parse(line);
      if (msg.method === 'initialize' && msg.id) {
        const response = {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: 'test',
            capabilities: {},
            serverInfo: { name: 'test-server', version: '1.0.0' }
          }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (e) {}
  });
});

// MCP protocol: exit when stdin closes
process.stdin.on('end', () => {
  process.exit(0);
});

// Keep the process running but allow clean exit
setInterval(() => {}, 1000).unref();