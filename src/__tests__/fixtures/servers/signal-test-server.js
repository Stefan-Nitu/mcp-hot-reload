#!/usr/bin/env node

// Test server that logs when it receives signals
import { spawn } from 'child_process';

process.stdin.resume();

// Optionally spawn a child process for testing process tree cleanup
if (process.env.SPAWN_CHILD === 'true') {
  const child = spawn('node', ['-e', `
    setInterval(() => {
      process.stderr.write('child process alive\\n');
    }, 500).unref();
    // Child should also handle stdin closing
    process.stdin.on('end', () => process.exit(0));
    process.stdin.resume();
  `], { stdio: ['pipe', 'inherit', 'inherit'] });

  // Forward stdin to child
  process.stdin.pipe(child.stdin);
}

process.on('SIGTERM', () => {
  console.error('Server received SIGTERM');
  process.exit(143);
});

process.on('SIGINT', () => {
  console.error('Server received SIGINT');
  process.exit(130);
});

// MCP protocol: exit when stdin closes
process.stdin.on('end', () => {
  console.error('Server stdin closed, exiting');
  process.exit(0);
});

// Keep running but allow clean exit
setInterval(() => {
  if (process.env.SPAWN_CHILD === 'true') {
    process.stderr.write('parent process alive\n');
  }
}, 1000).unref();