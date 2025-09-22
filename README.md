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
- **Crash recovery** - Automatically handles server crashes with helpful error messages
- **Protocol compliance** - Properly handles MCP protocol requirements
- **Flexible file watching** - Supports glob patterns for any programming language
- **Smart build handling** - Automatically detects when builds are needed (supports both compiled and interpreted languages)

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

1. **Initialize configuration** (recommended):

```bash
cd /path/to/your/mcp-server
npx mcp-hot-reload --init
```

This creates a `hot-reload.config.json` with sensible defaults. Edit it if needed, then run:

```bash
npx mcp-hot-reload
```

2. **Or use command line arguments**:

```bash
npx mcp-hot-reload node dist/index.js --watch src/**/*.ts
```

This will:
- Start your server with the specified command
- Watch for file changes in your source directory
- Run the build command when files change (if configured)
- Restart the server while preserving the session

### Integration with Claude Desktop

Update your `claude_desktop_config.json`:

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
        "/path/to/your/mcp-server/src/**/*.ts"
      ]
    }
  }
}
```

To watch multiple paths, use comma-separated patterns:

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
        "/path/to/your/mcp-server/src,/path/to/your/mcp-server/lib,/path/to/your/mcp-server/config"
      ]
    }
  }
}
```

Or specify exact file types with glob patterns:

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
        "/path/to/your/mcp-server/src/**/*.{ts,tsx},/path/to/your/mcp-server/lib/**/*.js"
      ]
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

Create a `hot-reload.config.json` in your project root:

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
  "buildCommand": "",  // Empty for interpreted languages
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
  "buildCommand": "",  // Empty for interpreted languages
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

## Build Commands - When Are They Needed?

The `buildCommand` determines what happens before server restart. Understanding when builds are required helps optimize your development workflow:

### Compiled Languages (Build Required)

Languages that compile to different output need a build step:

```json
{
  "serverCommand": "node",
  "serverArgs": ["dist/index.js"],  // Running compiled output
  "buildCommand": "tsc",              // Must compile TypeScript → JavaScript
  "watchPattern": "./src/**/*.ts"
}
```

### Interpreted Languages (No Build Needed)

Languages that run source directly can skip the build:

```json
{
  "serverCommand": "python",
  "serverArgs": ["src/server.py"],   // Running source directly
  "buildCommand": "",                 // Empty - Python doesn't need compilation
  "watchPattern": "./src/**/*.py"
}
```

### Quick Reference

| Language | Build Needed? | Example buildCommand | Why? |
|----------|--------------|---------------------|------|
| TypeScript → JavaScript | ✅ Yes | `tsc` or `npm run build` | Compiles to JavaScript |
| Python | ❌ No | `""` (empty) | Interprets source directly |
| JavaScript | ❌ No | `""` or optional linter | Runs source directly |
| Go | ✅ Yes | `go build` | Compiles to binary |
| Rust | ✅ Yes | `cargo build` | Compiles to binary |
| Ruby | ❌ No | `""` (empty) | Interprets source directly |
| C/C++ | ✅ Yes | `make` or `gcc` | Compiles to binary |

**Rule of thumb:** If `serverArgs` points to compiled output (`dist/`, `build/`, `.exe`), you need a build. If it points to source files (`.py`, `.js`, `.rb`), build is optional.

## Performance Optimization

### Watch Pattern Best Practices

⚠️ **IMPORTANT WARNING**: Never use broad patterns like `/**/*.js` or `/**/*.ts` at the project root level. This will watch thousands of files including node_modules and cause performance issues or crashes!

For large projects, specific watch patterns prevent performance issues:

#### ❌ Avoid Overly Broad Patterns

```json
{
  "watchPattern": "."  // Watches ENTIRE project including node_modules!
}
```

```json
{
  "watchPattern": "/**/*.js"  // NEVER DO THIS - watches entire filesystem!
}
```

```json
{
  "watchPattern": "/path/to/project/**/*.js"  // Still too broad - includes node_modules!
}
```

**Problems:**
- High CPU usage from watching thousands of files
- Slow startup while indexing files
- False rebuilds from unrelated file changes
- Can cause infinite loops (source → build → dist changes → rebuild)

#### ✅ Use Specific Patterns

```json
{
  "watchPattern": "./src/**/*.ts"  // Only TypeScript files in src
}
```

#### ✅ Watch Multiple Specific Directories

```json
{
  "watchPattern": [
    "./src/**/*.ts",
    "./lib/**/*.ts",
    "./config/**/*.json"
  ]
}
```

### Performance Tips

- **Be specific with extensions:** Use `*.ts` not `*`
- **Exclude generated files:** Don't watch `dist/`, `build/`, `coverage/`
- **Auto-excluded:** The proxy automatically ignores `node_modules/`, `.git/`, and `dist/`
- **Use debouncing:** Increase `debounceMs` for projects with many files
- **Monitor performance:** Use `top` or Activity Monitor to check CPU usage

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

### Crash Handling

The hot-reload proxy automatically detects and handles server crashes, providing detailed error information to help diagnose issues:

#### Automatic Recovery
- **Crash Detection**: Monitors server process for unexpected termination
- **Error Reporting**: Sends descriptive JSON-RPC error to client with crash details
- **Pending Request Handling**: Properly responds to any in-flight requests when crash occurs
- **Ready for Restart**: After a crash, saving any watched file triggers rebuild and restart

#### Exit Code Interpretation
The proxy provides helpful descriptions for common exit scenarios:

| Exit Condition | Description |
|---------------|-------------|
| SIGSEGV | Segmentation fault - memory access violation |
| SIGKILL | Killed forcefully - possible out of memory |
| SIGTERM | Normal termination signal |
| Exit code 1 | General error - check server logs |
| Exit code 127 | Command not found |
| Exit code 137 | Killed (often out of memory) |
| Exit code 143 | Terminated by SIGTERM |

Example error response sent to client:
```json
{
  "jsonrpc": "2.0",
  "id": 123,
  "error": {
    "code": -32603,
    "message": "MCP server process terminated unexpectedly (exit code 1 - general error, check server logs). Hot-reload will attempt to restart on next file change.",
    "data": {
      "exitCode": 1,
      "signal": null,
      "method": "tools/call",
      "info": "Save a file to trigger rebuild and restart, or check server logs for crash details."
    }
  }
}
```

## API Reference

### CLI Options

```bash
mcp-hot-reload [options] [serverCommand] [serverArgs...] [--watch patterns]
```

| Option | Description |
|--------|-------------|
| `--help`, `-h` | Show help message |
| `--version`, `-v` | Show version number |
| `--init` | Create a hot-reload.config.json with default settings |
| `--watch <patterns>` | Comma-separated glob patterns to watch |

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverCommand` | `string` | `'node'` | Command to start your server |
| `serverArgs` | `string[]` | `['dist/index.js']` | Arguments for server command |
| `buildCommand` | `string` | `'npm run build'` | Command to rebuild your server (can be empty for interpreted languages) |
| `watchPattern` | `string \| string[]` | `'./src'` | What to watch for changes:<br>• **Directory** (e.g., `./src`): Watches all TypeScript files<br>• **Glob pattern** (e.g., `./src/**/*.py`): Watches specific file types<br>• **Performance tip:** Be specific to avoid watching unnecessary files |
| `debounceMs` | `number` | `300` | Milliseconds to wait before rebuilding |
| `env` | `object` | `{}` | Environment variables for server process |

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
// hot-reload.config.json
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
      "type": "stdio",
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
// hot-reload.config.json
{
  "serverCommand": "python",
  "serverArgs": ["-u", "src/server.py"],
  "buildCommand": "",  // Python doesn't need a build step
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

- **Unit tests**: Core functionality testing (run in parallel)
- **Integration tests**: Component interaction testing (run sequentially)
- **E2E tests**: Full MCP protocol flow testing (run sequentially)

```bash
# Run all tests
npm test

# Run unit tests only (fast, parallel)
npm run test:unit

# Run integration and E2E tests only (sequential)
npm run test:e2e

# Run specific test suite
npm test -- message-parser

# Generate coverage report
npm run test:coverage
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

### Alternative: Local Installation

If mcp-hot-reload is installed locally in your project:

```json
{
  "mcpServers": {
    "your-server": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "mcp-hot-reload",
        "node",
        "/path/to/your/mcp-server/dist/index.js",
        "--watch",
        "/path/to/your/mcp-server/src/**/*.ts"
      ]
    }
  }
}
```

Or run directly from mcp-hot-reload source:

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
        "/path/to/your/mcp-server/src/**/*.ts"
      ]
    }
  }
}
```

### Configuration Best Practices

- **Use absolute paths** for server executables to ensure reliability
- **Use absolute paths** for watch patterns in production configs
- The default watch pattern `./src` works when running from your server directory
- Watch patterns are resolved relative to where the proxy runs

## Troubleshooting

### Server not restarting

- Verify your build command succeeds: `npm run build`
- Check file watch patterns match your source files
- Look for build errors in console output
- Ensure watch patterns use correct glob syntax

### Messages being lost

- Increase debounce time if builds are slow
- Check for initialization failures in logs
- Verify server outputs valid JSON-RPC messages

### High CPU usage

- **Use specific watch patterns** instead of watching entire directories
- **Increase debounce time** to reduce rebuild frequency
- **Check watch pattern specificity** - avoid patterns like `"."`
- **Verify exclusions** are working (node_modules should not trigger changes)
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