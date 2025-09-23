#!/usr/bin/env node

// Message tracker server that writes marker files for each received message
// Used to verify messages are sent exactly once
import fs from 'fs';
import path from 'path';

let messageCount = 0;
const markerDir = process.env.MARKER_DIR;

if (!markerDir) {
  process.stderr.write('MARKER_DIR environment variable must be set\n');
  process.exit(1);
}

// Ensure marker directory exists
fs.mkdirSync(markerDir, { recursive: true });

process.stdin.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  lines.forEach(line => {
    try {
      const msg = JSON.parse(line);
      messageCount++;

      // Write a marker file for each message
      fs.writeFileSync(
        path.join(markerDir, `msg-${messageCount}-${msg.method || 'response'}.txt`),
        JSON.stringify(msg, null, 2)
      );

      if (msg.method === 'initialize') {
        const response = {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'message-tracker', version: '1.0.0' }
          }
        };
        console.log(JSON.stringify(response));
      }
    } catch (e) {
      // Ignore parse errors
    }
  });
});

// MCP protocol: exit when stdin closes
process.stdin.on('end', () => {
  process.exit(0);
});

// Keep the process running but allow clean exit
setInterval(() => {}, 1000).unref();