# Development Notes & Lessons Learned

## Critical Issues & Solutions

### Zombie Test Processes & Vitest Hanging (FIXED)
**Issue**: Vitest processes hanging and not cleaning up, leaving multiple node/vitest processes running
**Root Causes**:
1. Test cleanup not aggressive enough (only 500ms timeout)
2. Open handles keeping Node.js alive (timers, file watchers, child processes)
3. Unresolved promises in tests

**Solution**:
- Increased timeout to 1000ms in `test/utils/process-cleanup.ts`
- Added multi-stage kill (SIGTERM → SIGKILL → kill by PID)
- Always run cleanup in afterEach hooks
- Added comprehensive logging to track process lifecycle:
  - `[CLEANUP]` prefix for all cleanup operations
  - Logs PID, exit codes, signals
  - Tracks each escalation step (stdin close → SIGTERM → SIGKILL)
- Created `test/utils/detect-hanging.ts` to identify what keeps Vitest alive
- Added npm scripts for debugging:
  - `npm run test:detect-hanging` - Run with hanging detection
  - `npm run test:force-exit` - Force exit after tests complete

**How to Debug Hanging Tests**:
```bash
# Run with hanging detection
npm run test:detect-hanging

# If Vitest hangs, look for:
# - [HANGING] Active handles: X
# - [HANGING] Active requests: X
# - Open file descriptors, timers, child processes

# Force exit if needed
npm run test:force-exit
```

### Test Logger Usage (RESOLVED)
**Decision**: Use `console.error` in tests instead of application logger
**Reasoning**:
- Tests should be independent of application code
- Avoids import path complexity
- Standard practice in test suites
- console.error writes to stderr (MCP protocol safe)

### Slow Shutdown Causing SIGTERM Escalation
**Issue**: MCP clients send SIGTERM after ~300ms if process doesn't exit on SIGINT
**Observation**: Node.js takes ~260ms to exit when stdio streams are piped
**Current Status**: Process exits cleanly but client still sends SIGTERM as fallback

## Logging Requirements

### ⚠️ CRITICAL: Always Use the Logger

**ALWAYS use the Pino logger via `createLogger()`** instead of console methods in application code:

```typescript
import { createLogger } from './utils/logger.js';
const log = createLogger('module-name');

// ✅ BEST - structured logging with context
log.info('Server started');
log.error({ err }, 'Failed to start');

// ❌ NEVER - breaks MCP protocol!
console.log('Server started');  // Writes to stdout - BREAKS PROTOCOL

// 🟡 WORKS but not ideal
console.error('Failed to start');  // Writes to stderr - protocol safe but no structure
```

**Why use the logger instead of console methods:**
- **MCP Protocol Compliance**: `console.log()` writes to stdout and BREAKS the JSON-RPC protocol. The logger always writes to stderr.
- **Structured Logging**: Pino provides JSON-structured logs with timestamps, log levels, module context, and proper error serialization.
- **Consistency**: Using the logger everywhere ensures consistent log formatting and filtering.
- **Performance**: Pino is highly optimized for production use.

**Exceptions (CLI-only contexts):**
- `index.ts` CLI commands (--help, --version, --init) may use `console.log()` for user-facing output when NOT running as a proxy
- Test files may use `console.error()` for debugging output (though logger is still preferred)

**Remember**: While `console.error()` is technically safe (writes to stderr), always prefer the logger for better structure and consistency.

## Test Execution Configuration

### Parallel vs Sequential Execution
- **Unit tests**: Run in parallel (default `vitest.config.ts`)
- **Integration/E2E tests**: Run sequentially (`vitest.config.e2e.ts` with `fileParallelism: false`)
- This prevents resource conflicts while keeping unit tests fast

### Useful Test Commands

```bash
# Run specific test file (vitest filters by filename pattern)
npx vitest src/services/mcp-server-lifecycle.unit.test.ts

# Run all tests in a directory
npx vitest src/services

# Run tests matching a name pattern
npx vitest -t "should handle stdin closure"

# Run multiple specific test files
npx vitest run src/mcp-proxy.e2e.test.ts src/process-cleanup.e2e.test.ts

# Control log output (Unix/Mac)
LOG_LEVEL=debug npx vitest run    # Full debug output
LOG_LEVEL=silent npx vitest run   # No logs
LOG_LEVEL=warn npx vitest run     # Warnings and errors only

# Control log output (Cross-platform with cross-env)
npx cross-env LOG_LEVEL=debug vitest run
npx cross-env LOG_LEVEL=silent vitest run

# Debug a specific test
npx vitest run --no-coverage -t "test name" --reporter=verbose

# Run tests in specific order (no randomization)
npx vitest run --sequence.shuffle=false

# Run tests affected by recent changes
npx vitest run --changed HEAD~1

# Increase timeout for slow E2E tests
npx vitest run --testTimeout=20000

# Run with limited threads to debug concurrency issues
npx vitest run --poolOptions.threads.maxThreads=1

# Watch mode for development
npx vitest  # Default is watch mode
```

### npm Scripts vs Direct Vitest

```bash
# Using npm scripts (runs both unit and E2E)
npm test

# Using npm scripts for specific suites
npm run test:unit    # Fast, parallel
npm run test:e2e     # Sequential

# Convenience scripts with cross-platform env vars
npm run test:debug   # LOG_LEVEL=debug with verbose reporter
npm run test:silent  # LOG_LEVEL=silent for minimal output

# Direct vitest for fine control
npx vitest run -t "specific test"
npx vitest src/specific-file.test.ts
```

### Common Test Pitfalls

1. **Stderr buffering** - Multiple messages can arrive in one chunk
   ```typescript
   // Use matchAll with global flag, not match
   const matches = output.matchAll(/Server PID: (\d+)/g);
   ```

2. **Test cleanup** - Always use cleanup utilities in afterEach
   ```typescript
   afterEach(async () => {
     await cleanupProxyProcess(proxyProcess);
     cleanupTestDirectory(testDir);
   });
   ```

3. **Sequential execution** - E2E tests must use `describe.sequential()` to prevent conflicts

For comprehensive testing documentation, see [TESTING.md](./TESTING.md)

## Stale Build Artifacts Breaking Signal Handling

**Issue**: After refactoring, the global `mcp-hot-reload` command wasn't exiting immediately on SIGINT/SIGTERM, causing MCP clients to escalate signals.

**Root Causes**:
1. **Stale `.js` files in dist/**: When files are renamed or deleted in `src/`, TypeScript compiler doesn't remove the old compiled outputs. We had orphaned files like:
   - `dist/mcp-hot-reload.js` (from old src file, Sep 18)
   - `dist/mcp-proxy-refactored.js` (from old refactoring attempt)
   - `dist/session-manager.js` (from renamed file)

   These stale files contained OLD signal handling code with 5-second async cleanup that was causing the delay.

2. **Executable permissions lost after rebuild**: When `tsc` rebuilds, it doesn't preserve executable permissions on `dist/index.js`.

**Solution**:
1. Run `npm run clean && npm run build` to remove ALL old artifacts and rebuild fresh
2. Run `npm unlink && npm link` to restore executable permissions and update the global symlink

**Prevention**:
- Always use `npm run clean` before building after refactoring
- Consider adding a CI check to ensure no unexpected files in dist/
- Test the globally linked version after major refactors

## Signal Handling Timeline

**Observed MCP Client Behavior**:
- Sends SIGINT to proxy
- Waits ~286ms for process to exit
- If still running, sends SIGTERM
- Expects exit within total ~300ms

**Implementation**: Call `process.exit(0)` immediately after receiving signal. No async cleanup, no graceful shutdown.

**Known Issue**: Node.js takes ~260ms to exit when stdio streams are piped (as they are when launched by MCP clients). This is inherent to Node.js process teardown and cannot be optimized further. Even with immediate `process.exit(0)` and no cleanup, the process takes this long to terminate. The client will send SIGTERM as a fallback, but the proxy still exits cleanly with code 0.

## Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/). Your commit messages determine the version bump:

| Type | Description | Version Bump |
|------|-------------|--------------|
| `fix:` | Bug fixes | Patch (0.0.X) |
| `feat:` | New features | Minor (0.X.0) |
| `BREAKING CHANGE:` | Breaking changes | Major (X.0.0) |
| `chore:` | Maintenance tasks | No release |
| `docs:` | Documentation only | No release |
| `style:` | Code style changes | No release |
| `refactor:` | Code refactoring | No release |
| `perf:` | Performance improvements | Patch |
| `test:` | Test changes | No release |
| `ci:` | CI/CD changes | No release |

## TypeScript Build Gotchas

**Lesson**: The TypeScript compiler (`tsc`):
- Only creates/updates files, never removes orphaned outputs
- Doesn't preserve file permissions (like executable bits)
- Won't warn about stale outputs that no longer have source files

**Best Practice**: Include `clean` in your rebuild workflow when refactoring.

## Process Cleanup in E2E Tests

**Issue**: E2E tests spawning proxy processes need proper cleanup to avoid memory leaks and hanging tests.

**Key Finding**: The MCP proxy correctly handles stdin closure (exits on 'end' event) when configured properly. However, tests may encounter issues when:
1. The test directory doesn't contain expected server files (e.g., `dist/index.js`)
2. The server fails to start, preventing normal stdin event propagation

**Solution**: Created reusable cleanup utility in `test/utils/process-cleanup.ts`:
```typescript
export async function cleanupProxyProcess(proxy: ChildProcess | null): Promise<boolean>
```

**How It Works**:
1. Closes stdin (should trigger proxy exit per MCP protocol)
2. Waits 500ms for graceful exit
3. Force-kills if still running (prevents hanging tests)
4. Returns `true` if clean exit, `false` if force-kill was needed
5. Logs detailed warnings when memory leaks are detected

**Vitest Compatibility**:
- Stdin events DO fire correctly in Vitest environment
- The proxy exits properly when stdin closes IF the server starts successfully
- When server fails to start, the proxy may not exit cleanly, requiring force-kill

**Usage Pattern**:
```typescript
afterEach(async () => {
  await cleanupProxyProcess(proxy);
  proxy = null;
  cleanupTestDirectory(testDir);
  testDir = null;
});
```

**Prevention**:
- Always use valid server configurations in tests
- Create test-specific servers that handle stdin properly
- Use the cleanup utility consistently across all E2E tests