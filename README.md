# MCP Hot Reload &nbsp;![NPM Version](https://img.shields.io/npm/v/mcp-hot-reload) ![MIT licensed](https://img.shields.io/npm/l/mcp-hot-reload) ![Build Status](https://github.com/Stefan-Nitu/mcp-hot-reload/actions/workflows/test.yml/badge.svg)

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
  - [Default Configuration](#default-configuration)
  - [Custom Configuration](#custom-configuration)
  - [Configuration Examples](#configuration-examples)
- [How It Works](#how-it-works)
  - [Architecture](#architecture)
  - [Session Management](#session-management)
  - [Message Flow](#message-flow)
- [API Reference](#api-reference)
  - [Configuration Options](#configuration-options)
  - [Programmatic Usage](#programmatic-usage)
- [Examples](#examples)
  - [TypeScript Server](#typescript-server)
  - [Python Server](#python-server)
  - [Deno Server](#deno-server)
  - [Bun Server](#bun-server)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Overview

The MCP Hot Reload tool enables seamless development of Model Context Protocol (MCP) servers by automatically rebuilding and restarting your server when source files change, while preserving the session state between restarts.

Key benefits:
- **Zero downtime development** - Changes are applied without losing your connection
- **Session state preservation** - Maintains context across server restarts
- **Protocol compliance** - Properly handles MCP protocol requirements
- **Universal compatibility** - Works with any MCP server implementation

## Installation

```bash
npm install -g mcp-hot-reload
```

Or use directly with npx:

```bash
npx mcp-hot-reload
```

> ⚠️ Requires Node.js v18.x or higher

## Quick Start

### Basic Usage

In your MCP server directory:

```bash
npx mcp-hot-reload
```

This will:
1. Start your server (`node dist/index.js`)
2. Watch the `src/` directory for changes
3. Run `npm run build` when files change
4. Restart the server while preserving the session

### Integration with Claude Desktop

Update your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "your-server": {
      "command": "npx",
      "args": ["mcp-hot-reload"],
      "cwd": "/path/to/your/mcp-server"
    }
  }
}
```

## Configuration

### Default Configuration

The tool works out-of-the-box with these defaults:

| Setting | Default Value | Description |
|---------|--------------|-------------|
| Server Command | `node dist/index.js` | Command to start your MCP server |
| Build Command | `npm run build` | Command to rebuild your server |
| Watch Directory | `./src` | Directory to monitor for changes |
| Debounce | `300ms` | Delay before triggering rebuild |

### Custom Configuration

Create a `proxy.config.json` in your project root:

```json
{
  "serverCommand": "node",
  "serverArgs": ["dist/index.js"],
  "buildCommand": "npm run build",
  "watchPattern": ["./src", "./config"],
  "debounceMs": 300,
  "env": {
    "LOG_LEVEL": "debug",
    "NODE_ENV": "development"
  }
}
```

### Configuration Examples

#### TypeScript Server

```json
{
  "serverArgs": ["build/server.js"],
  "buildCommand": "tsc",
  "watchPattern": ["./src/**/*.ts"]
}
```

#### Python Server

```json
{
  "serverCommand": "python",
  "serverArgs": ["src/server.py"],
  "buildCommand": "echo 'No build needed'",
  "watchPattern": ["./src/**/*.py"]
}
```

#### Deno Server

```json
{
  "serverCommand": "deno",
  "serverArgs": ["run", "--allow-all", "src/mod.ts"],
  "buildCommand": "deno cache src/mod.ts",
  "watchPattern": ["./src/**/*.ts"]
}
```

#### Bun Server

```json
{
  "serverCommand": "bun",
  "serverArgs": ["run", "src/index.ts"],
  "buildCommand": "bun build ./src/index.ts --outdir ./dist",
  "watchPattern": ["./src/**/*.ts"]
}
```

## How It Works

### Architecture

The hot-reload tool acts as a transparent proxy between the MCP client and your server:

```
┌──────────┐     STDIO/JSON-RPC     ┌─────────────────┐     STDIO/JSON-RPC     ┌──────────────┐
│  Claude  │ ◄─────────────────────► │ mcp-hot-reload  │ ◄─────────────────────► │  MCP Server  │
└──────────┘                         └─────────────────┘                         └──────────────┘
                                             │
                                             ▼
                                     [File Watcher]
                                             │
                                             ▼
                                     [Build System]
```

### Session Management

1. **Initialization Capture**: Stores the initial handshake parameters
2. **Message Buffering**: Queues incoming messages during restart
3. **State Replay**: Re-establishes connection with stored parameters
4. **Message Replay**: Processes buffered messages after restart
5. **Notification**: Sends `tools/list_changed` to inform client

### Message Flow

#### Normal Operation
1. Client sends request → Proxy forwards to server
2. Server sends response → Proxy forwards to client

#### During Restart
1. File change detected → Debounce timer starts
2. Build command executes
3. Messages are buffered in memory
4. Server gracefully shuts down
5. New server process spawns
6. Initialize handshake replayed
7. Buffered messages replayed
8. Normal operation resumes

## API Reference

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverCommand` | `string` | `'node'` | Command to start your server |
| `serverArgs` | `string[]` | `['dist/index.js']` | Arguments for server command |
| `buildCommand` | `string` | `'npm run build'` | Command to rebuild your server |
| `watchPattern` | `string \| string[]` | `'./src'` | Patterns to watch for changes |
| `debounceMs` | `number` | `300` | Milliseconds to wait before rebuilding |
| `env` | `object` | `{}` | Environment variables for server process |
| `cwd` | `string` | `process.cwd()` | Working directory |

### Programmatic Usage

```typescript
import { MCPHotReload } from 'mcp-hot-reload';

const hotReload = new MCPHotReload({
  buildCommand: 'npm run build',
  watchPattern: ['./src', './config'],
  debounceMs: 300,
  serverCommand: 'node',
  serverArgs: ['dist/index.js'],
  env: {
    LOG_LEVEL: 'debug'
  }
});

// Start the hot-reload proxy
await hotReload.start();

// Gracefully stop
await hotReload.stop();
```

## Examples

### TypeScript Server

Complete setup for a TypeScript MCP server:

```json
// proxy.config.json
{
  "serverCommand": "node",
  "serverArgs": ["dist/index.js"],
  "buildCommand": "tsc",
  "watchPattern": ["./src/**/*.ts", "./src/**/*.json"],
  "debounceMs": 500
}
```

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "my-typescript-server": {
      "command": "npx",
      "args": ["mcp-hot-reload"],
      "cwd": "/Users/me/projects/my-mcp-server"
    }
  }
}
```

### Python Server

Setup for a Python MCP server:

```json
// proxy.config.json
{
  "serverCommand": "python",
  "serverArgs": ["-u", "src/server.py"],
  "buildCommand": "python -m py_compile src/**/*.py",
  "watchPattern": ["./src/**/*.py"],
  "env": {
    "PYTHONUNBUFFERED": "1"
  }
}
```

## Development

```bash
# Clone the repository
git clone https://github.com/Stefan-Nitu/mcp-hot-reload.git
cd mcp-hot-reload

# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build the project
npm run build

# Clean build artifacts
npm run clean
```

### Testing

The project includes comprehensive test coverage:

- **Unit tests**: Core functionality testing
- **Integration tests**: Component interaction testing
- **E2E tests**: Full MCP protocol flow testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- message-parser

# Generate coverage report
npm test -- --coverage
```

## Troubleshooting

### Server not restarting

- Verify your build command succeeds: `npm run build`
- Check file watch patterns match your source files
- Look for build errors in console output

### Messages being lost

- Increase debounce time if builds are slow
- Check for initialization failures in logs
- Verify server outputs valid JSON-RPC messages

### High CPU usage

- Increase debounce time to reduce rebuild frequency
- Check for recursive file watch patterns
- Ensure build process terminates properly

### Common Issues

| Issue | Solution |
|-------|----------|
| "Cannot find module" | Ensure build output path matches `serverArgs` |
| "EADDRINUSE" | Previous server didn't shut down, check for orphan processes |
| "Build failed" | Run build command manually to see detailed errors |
| Session not preserved | Check that initialization message is properly formatted |

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.