#!/usr/bin/env node

// MCP server that returns text content
process.stderr.write('[test-server] Text content server started\n');

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const message = JSON.parse(line);

      if (message.method === 'initialize') {
        const response = {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'text-content-server', version: '1.0.0' },
            capabilities: { tools: {} }
          }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
        process.stderr.write('[test-server] Sent initialize response\n');
      }
      else if (message.method === 'tools/list') {
        const response = {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: [
              { name: 'getText', description: 'Returns plain text content' },
              { name: 'getMultilineText', description: 'Returns multiline text' }
            ]
          }
        };
        process.stdout.write(JSON.stringify(response) + '\n');
      }
      else if (message.method === 'tools/call') {
        const { name, arguments: args } = message.params || {};

        if (name === 'getText') {
          const response = {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [{
                type: 'text',
                text: 'This is plain text content'
              }]
            }
          };
          process.stdout.write(JSON.stringify(response) + '\n');
        }
        else if (name === 'getMultilineText') {
          const response = {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [{
                type: 'text',
                text: 'Line 1\nLine 2\nLine 3\n\nParagraph 2'
              }]
            }
          };
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      }
    } catch (e) {
      process.stderr.write(`[test-server] Parse error: ${e.message}\n`);
    }
  }
});

process.stdin.on('end', () => {
  process.stderr.write('[test-server] Input ended\n');
  process.exit(0);
});