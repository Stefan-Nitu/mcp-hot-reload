# Development Environment

## Hot Reload Setup
This project uses **mcp-hot-reload** for automatic rebuilding and restarting during development. When you make changes to the TypeScript source files:
- The server automatically rebuilds (`npm run build`)
- The MCP server restarts while preserving the session
- No manual rebuild or restart needed!

This means you can test changes immediately through the MCP tools without running `npm run build` manually.

# MANDATORY INITIALIZATION - DO THIS IMMEDIATELY

## ⚠️ STOP - READ THIS FIRST ⚠️

**YOU MUST READ THESE DOCUMENTS IMMEDIATELY UPON STARTING ANY CONVERSATION ABOUT THIS PROJECT.**
**DO NOT WAIT TO BE ASKED. DO NOT PROCEED WITHOUT READING THEM FIRST.**

### Required Documents (READ NOW IN THIS ORDER):
1. `docs/TESTING.md` - MCP server testing strategies with Vitest
2. `docs/DEVELOPMENT-NOTES.md` - Critical lessons learned and known issues

### Verification Checklist:
- [ ] I have read `docs/TESTING.md` completely
- [ ] I have read `docs/DEVELOPMENT-NOTES.md` completely
- [ ] I understand the testing approach (unit/integration/E2E separation, Vitest patterns)
- [ ] I understand test file naming (*.unit.test.ts, *.integration.test.ts, *.e2e.test.ts)
- [ ] I understand STDIO compliance (never write to stdout, always use stderr for logs)
- [ ] I understand protocol compliance testing requirements
- [ ] I understand stale build artifacts issue and prevention (`npm run clean`)
- [ ] I understand signal handling requirements (immediate exit, no async cleanup)
- [ ] I understand process cleanup patterns in E2E tests

If you haven't read these documents yet, STOP and read them now using the Read tool.
Only after reading the documents should you proceed to help the user.

## Critical MCP Server Requirements

### Logging
- **NEVER write to stdout** - This breaks the JSON-RPC protocol
- **ALWAYS use stderr** for logging (Pino configured for stderr)
- Use the logger via `createLogger()` for structured logging

### Error Handling
- **Tools return errors in content**, never throw JSON-RPC errors
- Handle all promise rejections properly
- Exit immediately on SIGINT/SIGTERM (within 250ms)

### Architecture
- Keep it **simple and functional** - MCP protocol is the abstraction layer
- Direct implementations without unnecessary abstraction
- Session preservation during server restarts

### Testing
- Use **Vitest** as the test framework
- Follow **strict test file naming**: *.unit.test.ts, *.integration.test.ts, *.e2e.test.ts
- Test **stderr vs stdout compliance** rigorously
- Mock external commands for fast, deterministic tests
- E2E tests must use real processes, no mocking internals

## Project Context

This is an MCP (Model Context Protocol) hot-reload proxy. The codebase should follow:
- Simple, functional architecture (not over-engineered)
- MCP protocol compliance (stderr for logs, proper JSON-RPC)
- Comprehensive testing with Vitest
- Session preservation during restarts
- Immediate signal handling (SIGINT/SIGTERM)
- Transparent proxy between MCP client and server