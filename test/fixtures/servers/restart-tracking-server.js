#!/usr/bin/env node

// Server that tracks restart count to a file
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Get restart file from environment variable
const restartFile = process.env.RESTART_FILE || path.join(__dirname, 'restarts.txt');

// Track restarts
let count = 0;
try {
  count = parseInt(fs.readFileSync(restartFile, 'utf-8')) || 0;
} catch (e) {}
count++;
fs.writeFileSync(restartFile, count.toString());

process.stdin.on('data', (data) => {
  const messages = data.toString().split('\n').filter(line => line.trim());
  messages.forEach(line => {
    try {
      const msg = JSON.parse(line);
      if (msg.method === 'initialize' && msg.id) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { protocolVersion: 'test', capabilities: {} }
        }) + '\n');
      }
    } catch (e) {}
  });
});

setInterval(() => {}, 1000).unref();