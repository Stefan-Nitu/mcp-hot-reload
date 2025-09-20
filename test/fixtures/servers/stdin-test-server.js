#!/usr/bin/env node
// Server that can simulate different stdin behaviors based on environment variable

const mode = process.env.STDIN_TEST_MODE || 'normal';

if (mode === 'close-immediately') {
  // Close stdin immediately - simulates broken pipe
  process.stdin.destroy();
  // Keep process alive so readiness check can detect the issue
  setInterval(() => {
    process.stderr.write('Running without stdin\n');
  }, 100);
} else if (mode === 'close-after-delay') {
  // Close stdin after a short delay - simulates disconnect during operation
  setTimeout(() => {
    process.stdin.destroy();
  }, 200);
  // Keep alive
  setInterval(() => {
    process.stderr.write('Running\n');
  }, 100);
} else if (mode === 'exit-immediately') {
  // Exit immediately with error code
  process.exit(1);
} else if (mode === 'exit-after-delay') {
  // Exit after a delay - simulates crash during operation
  setTimeout(() => {
    process.exit(42);
  }, 200);
} else {
  // Normal operation
  process.stdin.on('data', (data) => {
    process.stdout.write(`echo: ${data}`);
  });
  process.stdin.on('end', () => {
    process.exit(0);
  });
  // Heartbeat to stderr
  setInterval(() => {
    process.stderr.write('Healthy\n');
  }, 100);
}