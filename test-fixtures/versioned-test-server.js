#!/usr/bin/env node
// Server version: VERSION_PLACEHOLDER

const version = 'VERSION_PLACEHOLDER';

process.stdin.on('data', (chunk) => {
  const lines = chunk.toString().split('\n');
  lines.forEach(line => {
    if (!line.trim()) return;

    try {
      const msg = JSON.parse(line);

      if (msg.method === 'initialize') {
        const response = {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: {
              name: 'test-server',
              version: version
            }
          }
        };
        console.log(JSON.stringify(response));
      } else if (msg.method === 'tools/list') {
        const response = {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [{
              name: 'version_tool',
              description: `Returns version ${version}`
            }]
          }
        };
        console.log(JSON.stringify(response));
      }
    } catch (e) {
      // Parse error
    }
  });
});