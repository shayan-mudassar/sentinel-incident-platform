export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

export type Logger = {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  withContext: (context: LogContext) => Logger;
};

const REDACT_KEYS = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key', 'token', 'secret', 'password'];
const REDACT_VALUE = '[REDACTED]';

const buildSecretValueSet = () => {
  const secrets = new Set<string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) {
      continue;
    }
    const upper = key.toUpperCase();
    if (upper.includes('SECRET') || upper.includes('TOKEN') || upper.includes('PASSWORD') || upper.includes('API_KEY')) {
      secrets.add(value);
    }
  }
  return secrets;
};

const SECRET_VALUES = buildSecretValueSet();

const shouldRedactKey = (key: string) => REDACT_KEYS.some((token) => key.toLowerCase().includes(token));

const redactValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    if (SECRET_VALUES.has(value)) {
      return REDACT_VALUE;
    }
    if (value.toLowerCase().startsWith('bearer ')) {
      return REDACT_VALUE;
    }
  }
  return value;
};

const sanitize = (input: unknown, key?: string): unknown => {
  if (key && shouldRedactKey(key)) {
    return REDACT_VALUE;
  }
  if (Array.isArray(input)) {
    return input.map((item) => sanitize(item));
  }
  if (input && typeof input === 'object') {
    const entries = Object.entries(input as Record<string, unknown>).map(([childKey, value]) => [
      childKey,
      sanitize(value, childKey)
    ]);
    return Object.fromEntries(entries);
  }
  return redactValue(input);
};

const emit = (level: LogLevel, message: string, base: LogContext, context?: LogContext) => {
  const payload = sanitize({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...base,
    ...(context || {})
  }) as Record<string, unknown>;

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
};

export const createLogger = (base: LogContext = {}): Logger => {
  const baseContext = {
    function: process.env.AWS_LAMBDA_FUNCTION_NAME,
    ...base
  };
  return {
    debug: (message, context) => emit('debug', message, baseContext, context),
    info: (message, context) => emit('info', message, baseContext, context),
    warn: (message, context) => emit('warn', message, baseContext, context),
    error: (message, context) => emit('error', message, baseContext, context),
    withContext: (context) => createLogger({ ...baseContext, ...context })
  };
};
