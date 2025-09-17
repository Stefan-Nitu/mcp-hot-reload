# mcp-dev-proxy

A robust hot-reload development proxy for MCP (Model Context Protocol) servers with full session management and protocol compliance.

## Features

- 🔄 **Hot Reload**: Automatically rebuilds and restarts your MCP server when source files change
- 📦 **Session Preservation**: Maintains MCP session state across server restarts
- 🎯 **Smart Message Buffering**: Queues and replays messages during restart with timeout handling
- 🔔 **Protocol Compliance**: Sends `tools/list_changed` notifications after restart
- ⚡ **Graceful Shutdown**: Properly manages server lifecycle with clean shutdown sequences
- 🔧 **Configurable**: Customize build commands, watch patterns, and debounce timing
- 📝 **JSON-RPC Integrity**: Maintains proper newline-delimited JSON-RPC message boundaries
- ⏱️ **Request Tracking**: Monitors and times out stale requests during restarts

## Installation

```bash
npm install -g mcp-dev-proxy
```

Or use directly with npx:

```bash
npx mcp-dev-proxy
```

## Usage

### With Claude Desktop

Update your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "your-server": {
      "command": "npx",
      "args": ["mcp-dev-proxy"],
      "cwd": "/path/to/your/mcp-server"
    }
  }
}
```

### Programmatic Usage

```typescript
import { MCPDevProxy } from 'mcp-dev-proxy';

const proxy = new MCPDevProxy({
  buildCommand: 'npm run build',
  watchPattern: ['./src', './config'],
  debounceMs: 300,
  serverCommand: 'node',
  serverArgs: ['dist/index.js'],
  cwd: process.cwd()
});

await proxy.start();
```

### Manual Usage

In your MCP server directory:

```bash
# Run the proxy with defaults
mcp-dev-proxy

# The proxy will:
# 1. Start your MCP server (runs `node dist/index.js`)
# 2. Watch `src/` directory for changes
# 3. Rebuild (`npm run build`) when changes are detected
# 4. Restart the server with session preservation
```

## How It Works

The proxy acts as a stateful layer between the MCP client and your server:

```
Claude <-> mcp-dev-proxy <-> Your MCP Server
        (maintains session)
```

### Session Management

1. **Initialization Tracking**: Captures and replays the MCP initialization handshake
2. **Message Correlation**: Tracks request/response pairs by ID
3. **State Preservation**: Maintains session state across server restarts
4. **Protocol Notifications**: Sends `tools/list_changed` after restart

### Message Flow

1. **Client → Proxy**: Messages are parsed and analyzed
2. **During Restart**: Messages are buffered in memory
3. **After Restart**: Initialize request is replayed, then buffered messages
4. **Proxy → Client**: Server responses forwarded, notifications injected

### Restart Sequence

1. File change detected → Debounce timer started
2. Build command executed (`npm run build`)
3. Graceful server shutdown (SIGTERM → wait → SIGKILL)
4. New server process spawned
5. Initialize handshake replayed
6. Buffered messages replayed in order
7. `tools/list_changed` notification sent

## Configuration

The proxy accepts these configuration options:

| Option | Default | Description |
|--------|---------|-------------|
| `buildCommand` | `'npm run build'` | Command to rebuild your server |
| `watchPattern` | `'./src'` | File/directory patterns to watch |
| `debounceMs` | `300` | Milliseconds to wait before rebuilding |
| `serverCommand` | `'node'` | Command to start your server |
| `serverArgs` | `['dist/index.js']` | Arguments for server command |
| `cwd` | `process.cwd()` | Working directory |
| `env` | `{}` | Additional environment variables |

## Requirements

- Node.js 18+
- An MCP server with:
  - Build command (e.g., `npm run build`)
  - Predictable output location
  - Source files to watch

## Architecture

### Core Components

- **MessageParser**: Handles JSON-RPC message parsing with partial message support
- **SessionManager**: Tracks MCP session state and message correlation
- **MCPDevProxy**: Main proxy orchestrator with process management

### Key Features

- **Message Buffering**: Queues messages during restart
- **Request Tracking**: Monitors pending requests with timeout support
- **Graceful Shutdown**: Proper process cleanup with fallback to SIGKILL
- **Debounce Logic**: Prevents excessive rebuilds
- **Error Handling**: Comprehensive error handling with stderr logging

## Development

```bash
# Install dependencies
npm install

# Build the proxy
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Clean build artifacts
npm run clean
```

## Testing

The project includes comprehensive test coverage:

- Unit tests for MessageParser
- Unit tests for SessionManager
- Integration tests for MCPDevProxy
- MCP protocol compliance tests

## Comparison with Other Solutions

| Feature | mcp-dev-proxy | MCP Inspector | Direct Restart |
|---------|---------------|---------------|----------------|
| Hot Reload | ✅ | ❌ | ❌ |
| Session Preservation | ✅ | ❌ | ❌ |
| Message Buffering | ✅ | ❌ | ❌ |
| Protocol Notifications | ✅ | ❌ | ❌ |
| Zero Config | ✅ | ✅ | ✅ |
| Production Ready | ✅ | ⚠️ | ❌ |

## Troubleshooting

### Server not restarting
- Check that your build command is correct
- Verify file watch patterns match your source files
- Look for build errors in stderr output

### Messages being lost
- Increase timeout thresholds if requests take long
- Check for initialization failures in logs
- Verify JSON-RPC message format compliance

### High CPU usage
- Increase debounce time to reduce rebuild frequency
- Check for recursive file watch patterns
- Ensure build process terminates properly

## License

MIT