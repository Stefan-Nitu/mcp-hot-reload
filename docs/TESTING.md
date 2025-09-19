# MCP Server Testing Guide

## Overview

This guide presents comprehensive testing strategies for TypeScript MCP (Model Context Protocol) servers, based on official best practices and the unique requirements of the MCP architecture.

## Core Testing Principles for MCP Servers

### 0. Test Behavior, Not Implementation

**The most important principle: Tests should focus on WHAT the system does, not HOW it does it.**

```typescript
// ❌ BAD: Testing implementation details
it('should call execAsync with correct parameters', () => {
  expect(mockExecAsync).toHaveBeenCalledWith('xcrun simctl list');
});

// ✅ GOOD: Testing behavior
it('should return list of available simulators', () => {
  const response = await handler({ action: 'list' });
  expect(response.status).toBe('success');
  expect(response.data.simulators).toContainEqual({
    name: 'iPhone 15',
    state: 'Shutdown'
  });
});
```

This ensures tests remain stable when refactoring internal implementation.

### 1. Protocol Compliance Testing

MCP servers must strictly adhere to the JSON-RPC protocol. Test for:

- **Message Format**: All responses must be valid JSON-RPC 2.0
- **Error Codes**: Use standard JSON-RPC error codes (-32700 to -32603)
- **Request/Response Matching**: Verify `id` fields match between requests and responses
- **Notification Handling**: Ensure notifications don't expect responses

### 2. STDIO Transport Testing

For servers using STDIO transport, critical requirements:

```typescript
// test/stdio.test.ts
describe('STDIO Transport Compliance', () => {
  it('should NEVER write logs to stdout', () => {
    // Arrange
    const stdoutSpy = jest.spyOn(process.stdout, 'write');
    const server = new MCPServer();

    // Act
    server.handleRequest({ method: 'tools/list', id: 1 });

    // Assert - stdout should only contain JSON-RPC messages
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\{"jsonrpc":"2\.0"/)
    );
  });

  it('should write all logs to stderr', () => {
    // Arrange
    const stderrSpy = jest.spyOn(process.stderr, 'write');

    // Act
    logger.info('Server started');

    // Assert
    expect(stderrSpy).toHaveBeenCalled();
  });
});
```

### 3. Tool Testing Strategy

Test MCP tools as isolated functions with clear inputs and outputs:

```typescript
// tools/__tests__/build.test.ts
import { buildTool, buildSchema } from '../build';
import { z } from 'zod';

describe('Build Tool', () => {
  describe('Schema Validation', () => {
    it('should accept valid input', () => {
      // Arrange
      const input = {
        projectPath: '/path/to/project.xcodeproj',
        scheme: 'MyApp',
        configuration: 'Debug'
      };

      // Act & Assert
      expect(() => buildSchema.parse(input)).not.toThrow();
    });

    it('should reject invalid project path', () => {
      // Arrange
      const input = {
        projectPath: 'not-a-project',
        scheme: 'MyApp'
      };

      // Act & Assert
      expect(() => buildSchema.parse(input)).toThrow(z.ZodError);
    });
  });

  describe('Tool Execution', () => {
    it('should return MCP-formatted response on success', async () => {
      // Arrange
      const mockExec = jest.fn().mockResolvedValue({
        stdout: 'Build Succeeded',
        stderr: ''
      });

      const input = buildSchema.parse({
        projectPath: '/test/project.xcodeproj',
        scheme: 'Test'
      });

      // Act
      const result = await buildTool(input, mockExec);

      // Assert
      expect(result).toEqual({
        content: [{
          type: 'text',
          text: expect.stringContaining('✅ Build succeeded')
        }]
      });
    });

    it('should handle build failures gracefully', async () => {
      // Arrange
      const mockExec = jest.fn().mockRejectedValue(
        new Error('Build failed: No such module')
      );

      // Act
      const result = await buildTool(validInput, mockExec);

      // Assert
      expect(result.content[0].text).toContain('❌');
      expect(result.content[0].text).toContain('Build failed');
    });
  });
});
```

## Testing with MCP Inspector

### Interactive Testing Workflow

The MCP Inspector is the primary tool for testing MCP servers during development:

```bash
# Test your compiled TypeScript server
npx @modelcontextprotocol/inspector node dist/index.js

# Test with arguments
npx @modelcontextprotocol/inspector node dist/index.js --config ./config.json
```

### Inspector Testing Checklist

1. **Connection Testing**
   - [ ] Server starts without errors
   - [ ] Capability negotiation succeeds
   - [ ] Server info is correctly displayed

2. **Tool Testing**
   - [ ] All tools appear in the Tools tab
   - [ ] Tool schemas are correctly displayed
   - [ ] Tools execute with valid inputs
   - [ ] Tools handle invalid inputs gracefully
   - [ ] Error messages are helpful and clear

3. **Resource Testing** (if applicable)
   - [ ] Resources list correctly
   - [ ] Resource content can be retrieved
   - [ ] Subscriptions work as expected

4. **Error Handling**
   - [ ] Invalid tool calls return proper errors
   - [ ] Network failures are handled gracefully
   - [ ] Timeout scenarios work correctly

## Unit Testing Patterns

### Testing Tool Functions

```typescript
describe('Simulator Tool', () => {
  let mockExecutor: jest.MockedFunction<ExecuteCommand>;

  beforeEach(() => {
    mockExecutor = jest.fn();
  });

  it('should list available simulators', async () => {
    // Arrange
    const mockOutput = JSON.stringify({
      devices: {
        'iOS 17.0': [{
          udid: 'TEST-UDID',
          name: 'iPhone 15',
          state: 'Booted'
        }]
      }
    });
    mockExecutor.mockResolvedValue({ stdout: mockOutput, stderr: '' });

    // Act
    const result = await listSimulators(mockExecutor);

    // Assert
    expect(result.content[0].text).toContain('iPhone 15');
    expect(result.content[0].text).toContain('Booted');
  });
});
```

### Testing Schema Validation

```typescript
describe('Input Validation', () => {
  it('should validate enum values strictly', () => {
    const schema = z.object({
      configuration: z.enum(['Debug', 'Release', 'Beta'])
    });

    // Valid
    expect(() => schema.parse({ configuration: 'Debug' })).not.toThrow();

    // Invalid
    expect(() => schema.parse({ configuration: 'debug' })).toThrow();
    expect(() => schema.parse({ configuration: 'Production' })).toThrow();
  });

  it('should provide helpful error messages', () => {
    try {
      projectPathSchema.parse('invalid-path');
    } catch (error) {
      expect(error.errors[0].message).toContain('must end with .xcodeproj');
    }
  });
});
```

## Integration Testing

### Testing Server Initialization

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

describe('Server Integration', () => {
  let server: Server;
  let transport: TestTransport;

  beforeEach(() => {
    server = new Server(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    transport = new TestTransport();
  });

  it('should handle initialization', async () => {
    // Act
    await server.connect(transport);
    const response = await transport.request('initialize', {
      protocolVersion: '1.0.0',
      capabilities: {}
    });

    // Assert
    expect(response.protocolVersion).toBe('1.0.0');
    expect(response.serverInfo.name).toBe('test-server');
  });

  it('should list available tools', async () => {
    // Arrange
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{
        name: 'build_xcode',
        description: 'Build an Xcode project',
        inputSchema: { type: 'object' }
      }]
    }));

    // Act
    await server.connect(transport);
    const response = await transport.request('tools/list');

    // Assert
    expect(response.tools).toHaveLength(1);
    expect(response.tools[0].name).toBe('build_xcode');
  });
});
```

## End-to-End Testing

### Testing with Claude Code

Claude Code is the IDE integration for MCP servers. Create a test configuration for Claude Code:

```json
{
  "mcpServers": {
    "xcode-server": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "LOG_LEVEL": "debug",
        "TEST_MODE": "true"
      }
    }
  }
}
```

### E2E Test Scenarios

```typescript
describe('E2E Claude Code Integration', () => {
  it('should connect to Claude Code successfully', async () => {
    // 1. Build the server
    // 2. Configure MCP settings in Claude Code
    // 3. Verify server appears in available tools
    // 4. Execute a build command through Claude Code
    // 5. Verify Xcode operations complete successfully
  });

  it('should handle file system operations in IDE context', async () => {
    // 1. Request file creation through Claude Code
    // 2. Verify approval dialog appears
    // 3. Confirm operation
    // 4. Verify file appears in project
  });
});
```

## Debugging and Troubleshooting

### Common Testing Issues

#### 1. Server Not Appearing in Inspector

```typescript
// Check for common issues
describe('Server Startup', () => {
  it('should not throw during initialization', () => {
    expect(() => new XcodeMCPServer()).not.toThrow();
  });

  it('should register all expected tools', () => {
    const server = new XcodeMCPServer();
    expect(server.getTools()).toContain('build_xcode');
    expect(server.getTools()).toContain('list_simulators');
  });
});
```

#### 2. Tool Execution Failures

```typescript
// Test error scenarios explicitly
it('should handle missing Xcode gracefully', async () => {
  mockExec.mockRejectedValue(new Error('xcodebuild: command not found'));

  const result = await buildTool(validInput);

  expect(result.content[0].text).toContain('Xcode is not installed');
});
```

### Logging for Tests

```typescript
// test/helpers/logger.ts
export class TestLogger {
  private logs: Array<{ level: string; message: string }> = [];

  log(level: string, message: string) {
    this.logs.push({ level, message });
    // Always use stderr in tests
    if (process.env.DEBUG_TESTS) {
      console.error(`[TEST ${level}] ${message}`);
    }
  }

  getLogs() {
    return this.logs;
  }

  clear() {
    this.logs = [];
  }
}
```

## Performance Testing

### Tool Response Times

```typescript
describe('Performance', () => {
  it('should respond to tool calls within 5 seconds', async () => {
    const start = Date.now();

    await simulatorTool.execute({
      action: 'list'
    });

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(5000);
  });

  it('should handle concurrent tool calls', async () => {
    const promises = Array(10).fill(null).map(() =>
      buildTool(validInput)
    );

    const results = await Promise.all(promises);

    results.forEach(result => {
      expect(result.content).toBeDefined();
    });
  });
});
```

## Security Testing

### Input Sanitization

```typescript
describe('Security', () => {
  it('should prevent command injection', async () => {
    const maliciousInput = {
      projectPath: '/test/project.xcodeproj"; rm -rf /',
      scheme: 'Test'
    };

    // Schema should reject this
    expect(() => buildSchema.parse(maliciousInput)).toThrow();
  });

  it('should validate file paths are within allowed directories', () => {
    const schema = z.string().refine(
      path => !path.includes('..'),
      'Path traversal not allowed'
    );

    expect(() => schema.parse('../../../etc/passwd')).toThrow();
  });
});
```

## Test Organization

### Test File Naming Convention

**MANDATORY: All test files must follow this strict naming convention:**

- `*.unit.test.ts` - Unit tests (isolated, fast, no I/O, mock all dependencies)
- `*.integration.test.ts` - Integration tests (test component interactions, mock only external boundaries like network/filesystem)
- `*.e2e.test.ts` - End-to-end tests (full MCP protocol flow, no mocks, real system interaction)

```
src/
├── simulator.ts
├── simulator.unit.test.ts        # Unit tests
├── simulator.integration.test.ts # Integration tests
└── simulator.e2e.test.ts         # E2E tests
```

### Recommended Test Structure

```
tests/
├── unit/                    # Fast, isolated tests
│   ├── tools/              # Tool function tests
│   ├── schemas/            # Validation tests
│   └── utils/              # Utility function tests
├── integration/            # Server integration tests
│   ├── initialization.test.ts
│   ├── tool-execution.test.ts
│   └── error-handling.test.ts
├── e2e/                    # End-to-end tests
│   └── claude-desktop.test.ts
└── fixtures/               # Test data and mocks
    ├── mock-responses.json
    └── test-projects/
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: MCP Server Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit

      - name: Run integration tests
        run: npm run test:integration

      - name: Test with MCP Inspector
        run: |
          npm run build
          npx @modelcontextprotocol/inspector node dist/index.js --test-mode
```

## Jest TypeScript Mocking Best Practices

### 1. Always Provide Explicit Type Signatures to jest.fn()

TypeScript requires explicit function signatures for proper type inference with mocks.

```typescript
// ❌ BAD - Causes "type never" errors
const mockFunction = jest.fn();
mockFunction.mockResolvedValue({ success: true }); // Error: type 'never'

// ✅ GOOD - Consistent approach with @jest/globals
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Use single type parameter with function signature
const mockFunction = jest.fn<() => Promise<{ success: boolean }>>();
mockFunction.mockResolvedValue({ success: true }); // Works!

// With parameters
const mockExecAsync = jest.fn<(cmd: string) => Promise<{ stdout: string; stderr: string }>>();

// Multiple parameters
const mockCallback = jest.fn<(error: Error | null, data?: string) => void>();
```

### 2. Mock Node.js Built-in Modules Correctly

```typescript
// Mock at module level before imports
const mockExecAsync = jest.fn<(cmd: string) => Promise<{ stdout: string; stderr: string }>>();
jest.mock('child_process');
jest.mock('util', () => ({
  promisify: () => mockExecAsync
}));

// Then import the module under test
import { listSimulators } from '../../../tools/simulator/list.js';
```

### 3. Match Async vs Sync Return Types

```typescript
// Synchronous
const mockSync = jest.fn<() => string>();
mockSync.mockReturnValue('result');

// Asynchronous
const mockAsync = jest.fn<() => Promise<string>>();
mockAsync.mockResolvedValue('result');
```

### 4. Factory Pattern for Test Setup

```typescript
function createSUT() {
  const mockExecute = jest.fn<(cmd: string) => Promise<{ stdout: string }>>();
  const mockExecutor: ICommandExecutor = { execute: mockExecute };
  const sut = new MyService(mockExecutor);
  return { sut, mockExecute }; // Return both for easy access
}

// Usage
it('should execute command', async () => {
  const { sut, mockExecute } = createSUT();
  mockExecute.mockResolvedValue({ stdout: 'success' });

  const result = await sut.run();
  expect(result).toBe('success');
});
```

### 5. Never Use Type Casting - Fix the Root Cause

```typescript
// ❌ BAD - Type casting hides problems
const mockFunction = jest.fn() as any;

// ✅ GOOD - Proper typing
type BuildFunction = (path: string) => Promise<BuildResult>;
const mockBuild = jest.fn<BuildFunction>();
```

### 6. Handling Classes with Private Properties

When mocking classes that have private properties, TypeScript requires type assertions:

```typescript
// ✅ GOOD - Type-safe mock with assertion
const mockQueue = {
  add: jest.fn<MessageQueue['add']>(),
  flush: jest.fn<MessageQueue['flush']>().mockReturnValue([])
} as unknown as jest.Mocked<MessageQueue>;

// ❌ BAD - Using as any loses all type safety
const mockQueue = { add: jest.fn() } as any;
```

### 7. Mocking Overloaded Methods (e.g., Stream.write)

Node.js streams have overloaded write signatures. Use proper type assertions:

```typescript
// ✅ GOOD - Maintains type safety for overloaded methods
const mockWrite = jest.fn<(chunk: any) => boolean>().mockReturnValue(true);
mockStream.write = mockWrite as typeof mockStream.write;

// For casting mock functions on existing objects
const startMock = processManager.start as jest.MockedFunction<typeof processManager.start>;
startMock.mockResolvedValue(mockProcess);
```

## Best Practices Summary

1. **Always test stderr vs stdout compliance** - Critical for STDIO transport
2. **Use explicit type signatures for jest.fn()** - Prevents TypeScript "never" errors
3. **Test schemas separately from logic** - Ensures validation works correctly
4. **Mock only at boundaries** - Keep tests fast but test real interactions
5. **Test error paths explicitly** - Users need clear error messages
6. **Validate MCP response format** - Must match protocol specification
7. **Use integration tests for protocol compliance** - Verify full message flow
8. **Keep tests focused and fast** - Run frequently during development
9. **Use factory methods for test setup** - Makes tests maintainable
10. **Never use type casting in tests** - Fix type issues properly

## Troubleshooting Test Failures

### Common Issues and Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Logs appearing in test output | Writing to stdout | Use `console.error` or configure logger for stderr |
| Tool not found in Inspector | Registration error | Check tool name and schema definition |
| Schema validation too strict | Over-specific regex | Use simpler patterns, validate in tool logic |
| Async tests timing out | Missing await | Ensure all async operations are awaited |
| Flaky integration tests | Race conditions | Use proper test setup/teardown, avoid shared state |

## Conclusion

Testing MCP servers requires attention to protocol compliance, proper STDIO handling, and comprehensive coverage of tools and error scenarios. Use the MCP Inspector as your primary development tool, complement with automated tests, and always ensure logs go to stderr, never stdout.