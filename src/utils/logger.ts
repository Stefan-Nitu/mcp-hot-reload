import pino from 'pino';

// For MCP protocol compliance, we MUST write to stderr, never stdout
const logLevel = process.env.LOG_LEVEL || (process.env.DEBUG ? 'debug' : 'info');

// Configure transport based on environment
const transport = process.env.NODE_ENV === 'production'
  ? undefined  // Use default high-performance stderr output in production
  : {
      target: 'pino-pretty',
      options: {
        destination: 2, // 2 = stderr file descriptor
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'HH:MM:ss.l',
        levelFirst: true,
        minimumLevel: logLevel  // Ensure pino-pretty respects our log level
      }
    };

// Create logger that writes to stderr
export const logger = pino({
  level: logLevel,
  base: {
    service: 'mcp-hot-reload',
  },
  ...(transport && { transport })
}, pino.destination(2)); // Always write to stderr

// Create child loggers for different modules
export const createLogger = (module: string) => logger.child({ module });

// Export convenience methods
export const logDebug = (module: string, message: string, ...args: any[]) => {
  createLogger(module).debug({ ...args }, message);
};

export const logInfo = (module: string, message: string, ...args: any[]) => {
  createLogger(module).info({ ...args }, message);
};

export const logWarn = (module: string, message: string, ...args: any[]) => {
  createLogger(module).warn({ ...args }, message);
};

export const logError = (module: string, message: string, error?: any) => {
  const log = createLogger(module);
  if (error instanceof Error) {
    log.error({ err: error }, message);
  } else if (error) {
    log.error({ error }, message);
  } else {
    log.error(message);
  }
};