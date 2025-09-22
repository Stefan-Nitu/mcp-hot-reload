/**
 * Simple MCP protocol message types for clarity in tests and usage
 */

// Initialize messages
export function createInitializeRequest(id: number | string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion: '1.0' }
  }) + '\n';
}

export function createInitializeResponse(id: number | string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: { protocolVersion: '1.0' }
  }) + '\n';
}

// Tool messages
export function createToolsListNotification(): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/list_changed'
  }) + '\n';
}

export function createToolCallRequest(id: number | string, toolName: string, args?: any): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: toolName, arguments: args }
  }) + '\n';
}

// Generic helpers
export function createRequest(id: number | string, method: string, params?: any): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    ...(params !== undefined && { params })
  }) + '\n';
}

export function createNotification(method: string, params?: any): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    method,
    ...(params !== undefined && { params })
  }) + '\n';
}

export function createResponse(id: number | string, result?: any, error?: any): string {
  if (error) {
    return JSON.stringify({
      jsonrpc: '2.0',
      id,
      error
    }) + '\n';
  }
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: result ?? {}
  }) + '\n';
}