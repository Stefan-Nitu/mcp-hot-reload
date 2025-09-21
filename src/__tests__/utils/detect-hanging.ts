/**
 * Utility to detect why Vitest is hanging
 * Add this to your test files to see what's keeping Node.js alive
 */

// Track active handles and timers
export function detectHanging(testName: string) {
  if (process.env.DEBUG_HANGING !== 'true') {
    return;
  }

  console.error(`\n[HANGING DETECTION] Starting for: ${testName}`);

  // Log active handles
  const activeHandles = (process as any)._getActiveHandles?.();
  if (activeHandles?.length > 0) {
    console.error(`[HANGING] Active handles: ${activeHandles.length}`);
    activeHandles.forEach((handle: any, i: number) => {
      const type = handle.constructor.name;
      const fd = handle.fd || handle._handle?.fd;
      console.error(`  ${i + 1}. ${type}${fd ? ` (fd: ${fd})` : ''}`);
    });
  }

  // Log active timers/requests
  const activeRequests = (process as any)._getActiveRequests?.();
  if (activeRequests?.length > 0) {
    console.error(`[HANGING] Active requests: ${activeRequests.length}`);
    activeRequests.forEach((req: any, i: number) => {
      console.error(`  ${i + 1}. ${req.constructor.name}`);
    });
  }

  // Use why-is-node-running if available
  try {
    const log = require('why-is-node-running');
    console.error('\n[HANGING] why-is-node-running output:');
    log();
  } catch (e) {
    // Package not installed, skip
  }
}

// Call this in afterAll() or at the end of your test
export function logOpenHandles() {
  detectHanging('Test Suite Complete');

  // Force exit after logging (only in CI or when needed)
  if (process.env.FORCE_EXIT === 'true') {
    console.error('[HANGING] Force exiting in 2 seconds...');
    setTimeout(() => {
      console.error('[HANGING] Force exit!');
      process.exit(0);
    }, 2000);
  }
}