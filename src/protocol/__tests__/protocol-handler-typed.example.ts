/**
 * Example showing how clean tests become with proper types
 */
import { describe, it, expect } from 'vitest';
import {
  createRequest,
  createNotification,
  createSuccessResponse,
  createErrorResponse,
  InitializeRequest,
  InitializeResponse,
  ToolCallRequest,
  ErrorCodes
} from '../../types/json-rpc.js';

describe('With Typed Messages (Example)', () => {
  it('initialize flow with proper types', () => {
    // Before: Manually constructing JSON
    const oldWay = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1.0' }
    };
    const oldRawMessage = JSON.stringify(oldWay) + '\n';

    // After: Type-safe message creation
    const initRequest = createRequest(1, 'initialize', {
      protocolVersion: '1.0'
    });
    const rawMessage = JSON.stringify(initRequest) + '\n';

    // Even better: Specific MCP types
    const typedInitRequest: InitializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '1.0' }
    };

    // Response is also typed!
    const initResponse: InitializeResponse = createSuccessResponse(1, {
      protocolVersion: '1.0',
      serverInfo: { name: 'test-server', version: '1.0.0' }
    });

    // Type guards make code clear
    if (isRequest(initRequest)) {
      // TypeScript knows this is a request
      expect(initRequest.method).toBe('initialize');
      expect(initRequest.id).toBeDefined();
    }

    if (isSuccessResponse(initResponse)) {
      // TypeScript knows this has a result
      expect(initResponse.result.protocolVersion).toBe('1.0');
    }
  });

  it('error handling with proper types', () => {
    // Creating error responses is clean and type-safe
    const errorResponse = createErrorResponse(
      42,
      ErrorCodes.InternalError,
      'MCP server process terminated unexpectedly (exit code 1)',
      {
        exitCode: 1,
        signal: null,
        method: 'tools/call'
      }
    );

    // TypeScript ensures structure is correct
    expect(errorResponse.error.code).toBe(-32603);
    expect(errorResponse.error.data.exitCode).toBe(1);
  });

  it('tool calls with proper types', () => {
    // Type-safe tool call
    const toolCall = createRequest<'tools/call'>(
      99,
      'tools/call',
      { name: 'search', arguments: { query: 'test' } }
    );

    // Or with specific type
    const typedToolCall: ToolCallRequest = {
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: {
        name: 'search',
        arguments: { query: 'test' }
      }
    };

    // Notifications don't have IDs - type system enforces this!
    const notification = createNotification(
      'notifications/progress',
      { percent: 50 }
    );
    // notification.id = 1; // TypeScript error! ✨
  });
});

// Helper to demonstrate type inference
function processMessage(msg: JSONRPCMessage) {
  if (isRequest(msg)) {
    // msg is JSONRPCRequest
    console.log(`Request ${msg.id}: ${msg.method}`);
  } else if (isNotification(msg)) {
    // msg is JSONRPCNotification
    console.log(`Notification: ${msg.method}`);
  } else if (isSuccessResponse(msg)) {
    // msg is JSONRPCSuccessResponse
    console.log(`Success response ${msg.id}:`, msg.result);
  } else if (isErrorResponse(msg)) {
    // msg is JSONRPCErrorResponse
    console.log(`Error response ${msg.id}:`, msg.error.message);
  }
}

// Compare the clarity:

// OLD: Everything is 'any', mistakes are easy
function oldProcessMessage(msg: any) {
  if (msg.method && msg.id) {
    // Is this right? What if id is 0?
  }
  if (msg.result) {
    // What if there's also an error?
  }
}

// NEW: Type system guides correct usage
function newProcessMessage(msg: JSONRPCMessage) {
  if (isRequest(msg)) {
    // Guaranteed to have id and method
    const { id, method, params } = msg;
  }
  if (isSuccessResponse(msg)) {
    // Guaranteed to have result, NOT error
    const { result } = msg;
  }
}