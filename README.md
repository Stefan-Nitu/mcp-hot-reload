[![NPM Version](https://img.shields.io/npm/v/mcp-hot-reload)](https://www.npmjs.com/package/mcp-hot-reload)
[![NPM Downloads](https://img.shields.io/npm/dm/mcp-hot-reload)](https://www.npmjs.com/package/mcp-hot-reload)
[![CI Status](https://github.com/Stefan-Nitu/mcp-hot-reload/actions/workflows/ci.yml/badge.svg)](https://github.com/Stefan-Nitu/mcp-hot-reload/actions/workflows/ci.yml)
[![MIT Licensed](https://img.shields.io/npm/l/mcp-hot-reload)](https://github.com/Stefan-Nitu/mcp-hot-reload/blob/main/LICENSE)

# MCP Hot Reload

**A development tool with automatic rebuild and restart for MCP (Model Context Protocol) servers**

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
- **Flexible file watching** - Supports glob patterns for any programming language

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

In your MCP server directory, provide the server command:

```bash
npx mcp-hot-reload node dist/index.js
```

Or with a configuration file (`proxy.config.json`):

```bash
npx mcp-hot-reload  # Uses settings from proxy.config.json
```

This will:
1. Start your server with the specified command
2. Watch the `src/` directory for changes (default)
3. Run `npm run build` when files change (default)
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
| Watch Pattern | `./src` | Directory to monitor (defaults to TypeScript files) |
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

#### TypeScript Server (Default)

When you specify just a directory, it automatically watches TypeScript files:

```json
{
  "serverArgs": ["dist/index.js"],
  "buildCommand": "tsc",
  "watchPattern": "./src"  // Watches all .ts, .tsx, .mts, .cts files
}
```

#### Python Server

For non-TypeScript servers, use glob patterns to specify file types:

```json
{
  "serverCommand": "python",
  "serverArgs": ["-u", "src/server.py"],
  "buildCommand": "echo 'No build needed'",
  "watchPattern": ["./src/**/*.py"],
  "env": {
    "PYTHONUNBUFFERED": "1"
  }
}
```

#### JavaScript Server

```json
{
  "serverCommand": "node",
  "serverArgs": ["src/index.js"],
  "buildCommand": "echo 'No build needed'",
  "watchPattern": ["./src/**/*.js", "./src/**/*.mjs"]
}
```

#### Multiple Directories/Patterns

```json
{
  "serverArgs": ["dist/index.js"],
  "buildCommand": "tsc",
  "watchPattern": [
    "./src",           // TypeScript files in src
    "./lib",           // TypeScript files in lib
    "./scripts/**/*.py" // Python scripts
  ]
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
┌──────────┐     STDIO/JSON-RPC      ┌─────────────────┐     STDIO/JSON-RPC      ┌──────────────┐
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
| `watchPattern` | `string \| string[]` | `'./src'` | What to watch for changes:<br>• **Directory** (e.g., `./src`): Watches all TypeScript files<br>• **Glob pattern** (e.g., `./src/**/*.py`): Watches specific file types |
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
  "watchPattern": "./src",
  "debounceMs": 500
}
```

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "my-typescript-server": {
      "command": "mcp-hot-reload",
      "args": [
        "node",
        "/Users/me/projects/my-mcp-server/dist/index.js",
        "--watch",
        "src/**/*.ts"
      ]
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

## Claude Code Configuration

The MCP server configuration in Claude Code is stored in `~/.claude.json` at the top level under the `mcpServers` key.

### Standard Setup (Global Installation)

After installing mcp-hot-reload globally (`npm install -g mcp-hot-reload`), configure your MCP server:

```json
{
  "mcpServers": {
    "your-server": {
      "type": "stdio",
      "command": "mcp-hot-reload",
      "args": [
        "node",
        "/path/to/your/mcp-server/dist/index.js",
        "--watch",
        "src/**/*.ts,src/**/*.js"  // Or "src/**/*.py" for Python, "src" for all types
      ]
    }
  }
}
```

### Alternative: Using Without Global Installation

If you prefer not to install globally, you can run mcp-hot-reload directly from its directory:

```json
{
  "mcpServers": {
    "your-server": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/path/to/mcp-hot-reload/dist/index.js",
        "node",
        "/path/to/your/mcp-server/dist/index.js",
        "--watch",
        "src/**/*.ts,src/**/*.js"
      ]
    }
  }
}
```

### Configuration Best Practices

- **Always use absolute paths** for server locations to ensure the configuration works from any directory
- **Never use `cwd`** in the configuration as it restricts where you can run Claude Code from
- The proxy automatically derives the working directory from the server's absolute path
- Watch patterns are resolved relative to the server's directory

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

## Releasing

To release a new version:

1. Update version in `package.json` and `package-lock.json`:
   ```bash
   npm version patch  # or minor/major
   ```
2. Commit the version bump
3. Push to main:
   ```bash
   git push origin main
   ```
4. The CD workflow will automatically:
   - Run all tests
   - Publish to npm if version changed
   - Create and push a git tag

### Commit Convention

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

#### Examples

```bash
# Patch release (1.0.0 -> 1.0.1)
git commit -m "fix: resolve file watching issue on Windows"

# Minor release (1.0.1 -> 1.1.0)
git commit -m "feat: add support for Python MCP servers"

# Major release (1.1.0 -> 2.0.0)
git commit -m "feat!: change configuration format

BREAKING CHANGE: watchPattern now requires glob syntax"

# No release
git commit -m "chore: update dependencies"
git commit -m "docs: improve README examples"
```

### Manual Release

If you need to trigger a release manually:

```bash
git commit --allow-empty -m "feat: trigger release"
git push origin main
```

## Contributing

We welcome contributions! Please follow the [Conventional Commits](#commit-convention) format when submitting changes.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes using conventional commits (e.g., `git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.