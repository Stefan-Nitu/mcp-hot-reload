import { Readable, Writable } from 'stream';
import { JSONRPCMessage } from '../types.js';

// Process management interfaces
export interface IProcessSpawner {
  spawn(config: {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  }): import('child_process').ChildProcess;
}

export interface IProcessTerminator {
  terminate(process: import('child_process').ChildProcess): Promise<void>;
}

export interface IProcessReadinessChecker {
  waitForReadiness(process: import('child_process').ChildProcess): Promise<void>;
}

// Server lifecycle interface
export type CrashHandler = (code: number | null, signal: NodeJS.Signals | null) => void;

export interface IServerLifecycle {
  start(): Promise<{ stdin: Writable; stdout: Readable }>;
  restart(): Promise<{ stdin: Writable; stdout: Readable }>;
  stop(): Promise<void>;
  setOnCrash(handler: CrashHandler): void;
}

// Hot reload interfaces
export interface IFileWatcher {
  start(): void;
  stop(): void;
  waitForChange(): Promise<string[]>;
}

export interface IBuildRunner {
  build(): Promise<boolean>;
}

export interface IHotReload {
  start(): void;
  stop(): void;
  waitForChange(): Promise<string[]>;
  buildOnChange(): Promise<boolean>;
}

// Messaging interfaces
export interface IMessageQueue<T = string> {
  add(item: T): void;
  flush(): T[];
  clear(): void;
  size(): number;
}

export interface IMessageParser {
  parseMessages(data: string): JSONRPCMessage[];
}

export interface ISessionTracker {
  processClientData(data: string): string;
  processServerData(data: string): string;
  getPendingRequest(): JSONRPCMessage | null;
  clearPendingRequest(): void;
  getInitializeRequest(): JSONRPCMessage | null;
  isInitialized(): boolean;
  reset(): void;
}

export interface IMessageRouter {
  connectServer(toServer: Writable, fromServer: Readable): void;
  disconnectServer(): void;
}

// Error notification interface
export interface IErrorNotifier {
  notifyClientOfCrash(code: number | null, signal: NodeJS.Signals | null): void;
  notifyClientOfBuildFailure(error: Error): void;
  notifyClientOfTimeout(requestId: string | number): void;
}

// Main proxy dependencies bundle
export interface IMCPProxyDependencies {
  messageRouter: IMessageRouter;
  sessionTracker: ISessionTracker;
  serverLifecycle: IServerLifecycle;
  hotReload: IHotReload;
}