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

export interface MCPInitializeRequest extends JSONRPCMessage {
  method: 'initialize';
  params: {
    protocolVersion: string;
    capabilities?: {
      tools?: {};
      resources?: {};
      prompts?: {};
    };
    clientInfo?: {
      name: string;
      version: string;
    };
  };
}

export interface MCPInitializeResponse extends JSONRPCMessage {
  result: {
    protocolVersion: string;
    capabilities?: {
      tools?: {};
      resources?: {};
      prompts?: {};
    };
    serverInfo: {
      name: string;
      version: string;
    };
  };
}

export interface ProxyConfig {
  buildCommand?: string;
  watchPattern?: string | string[];
  debounceMs?: number;
  serverCommand?: string;
  serverArgs?: string[];
  cwd?: string;
  env?: Record<string, string>;
  onExit?: (code: number) => void;  // Allow injection of exit behavior
}

export interface MessageBuffer {
  message: JSONRPCMessage;
  timestamp: number;
  raw: string;
}