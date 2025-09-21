export interface JSONRPCMessage {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

/**
 * Configuration for the MCP Proxy
 *
 * The proxy sits between:
 *   MCP Client (e.g., Claude, IDE) <-> MCPProxy <-> MCP Server (user's implementation)
 */
export interface ProxyConfig {
  buildCommand?: string;           // Command to build the MCP server
  watchPattern?: string | string[]; // Files to watch for changes
  debounceMs?: number;              // Debounce time before restarting MCP server
  mcpServerCommand?: string;        // Command to start the MCP server
  mcpServerArgs?: string[];         // Arguments for the MCP server command
  cwd?: string;                     // Working directory for the MCP server
  env?: Record<string, string>;     // Environment variables for the MCP server
  onExit?: (code: number) => void;  // Called when proxy exits (injected for testing)

  // Deprecated aliases for backward compatibility
  serverCommand?: string;
  serverArgs?: string[];
}