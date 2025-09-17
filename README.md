# mcp-hot-reload ![NPM Version](https://img.shields.io/npm/v/mcp-hot-reload) ![MIT licensed](https://img.shields.io/npm/l/mcp-hot-reload) ![Build Status](https://github.com/Stefan-Nitu/mcp-hot-reload/actions/workflows/test.yml/badge.svg)

Hot-reload development tool for MCP (Model Context Protocol) servers. Automatically rebuilds and restarts your server on file changes while preserving the session state.

## Features

- 🔄 **Hot Reload**: Automatically rebuilds and restarts your MCP server when source files change
- 📦 **Session Preservation**: Maintains MCP session state across server restarts
- 🎯 **Smart Message Buffering**: Queues and replays messages during restart
- 🔔 **Protocol Compliance**: Sends proper `tools/list_changed` notifications
- ⚡ **Zero Config**: Works out-of-the-box with sensible defaults
- 🔧 **Configurable**: Customize build commands, watch patterns, and more

## Installation

```bash
npm install -g mcp-hot-reload
```

Or use directly with npx:

```bash
npx mcp-hot-reload
```

## Quick Start

### 1. Basic Usage (Zero Config)

In your MCP server directory:

```bash
npx mcp-hot-reload
```

This will:
- Start your server (`node dist/index.js` by default)
- Watch the `src/` directory for changes
- Run `npm run build` when files change
- Restart the server automatically

### 2. With Claude Desktop

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

By default, mcp-hot-reload uses these settings:
- **Server command**: `node dist/index.js`
- **Build command**: `npm run build`
- **Watch directory**: `./src`
- **Debounce**: 300ms

### Custom Configuration

Create a `proxy.config.json` in your project root to customize:

```json
{
  "serverCommand": "node",
  "serverArgs": ["dist/index.js"],
  "buildCommand": "npm run build",
  "watchPattern": ["./src", "./config"],
  "debounceMs": 300
}
```

### Configuration Examples

#### TypeScript with Custom Build Output

```json
{
  "serverArgs": ["build/server.js"],
  "buildCommand": "npm run compile"
}
```

#### Python MCP Server

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

The hot-reload tool acts as a proxy between Claude and your MCP server:

```
Claude <-> mcp-hot-reload <-> Your MCP Server
        (maintains session)
```

1. **File Change Detection**: Watches your source files for changes
2. **Automatic Rebuild**: Runs your build command when changes are detected
3. **Graceful Restart**: Stops the old server and starts a new one
4. **Session Preservation**: Maintains the MCP session across restarts
5. **Message Buffering**: Queues messages during restart and replays them
6. **Protocol Compliance**: Sends notifications to inform Claude about changes

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `serverCommand` | `'node'` | Command to start your server |
| `serverArgs` | `['dist/index.js']` | Arguments for server command |
| `buildCommand` | `'npm run build'` | Command to rebuild your server |
| `watchPattern` | `'./src'` | File/directory patterns to watch |
| `debounceMs` | `300` | Milliseconds to wait before rebuilding |

## Programmatic Usage

```typescript
import { MCPHotReload } from 'mcp-hot-reload';

const hotReload = new MCPHotReload({
  buildCommand: 'npm run build',
  watchPattern: ['./src', './config'],
  debounceMs: 300,
  serverCommand: 'node',
  serverArgs: ['dist/index.js']
});

await hotReload.start();
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

## Requirements

- Node.js 18+
- An MCP server with a build process

## License

MIT