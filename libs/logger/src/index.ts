export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

export type Logger = {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  withContext: (context: LogContext) => Logger;
};

const emit = (level: LogLevel, message: string, base: LogContext, context?: LogContext) => {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...base,
    ...(context || {})
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
};

export const createLogger = (base: LogContext = {}): Logger => {
  return {
    debug: (message, context) => emit('debug', message, base, context),
    info: (message, context) => emit('info', message, base, context),
    warn: (message, context) => emit('warn', message, base, context),
    error: (message, context) => emit('error', message, base, context),
    withContext: (context) => createLogger({ ...base, ...context })
  };
};
