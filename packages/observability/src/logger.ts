import { getCorrelationId } from './correlation';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  msg: string;
  time: string;
  correlationId?: string;
  [key: string]: unknown;
}

/** Where records go. Defaults to JSON lines on the console; tests inject a capturing sink. */
export interface LogSink {
  write(record: LogRecord): void;
}

const consoleSink: LogSink = {
  write(record) {
    // One structured JSON line per event — friendly to log aggregators / OpenTelemetry export.
    process.stdout.write(`${JSON.stringify(record)}\n`);
  },
};

export interface LoggerOptions {
  sink?: LogSink;
  /** Fields attached to every record (e.g. { service: 'b2b-api' }). */
  base?: Record<string, unknown>;
  now?: () => number;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * A structured logger that automatically stamps every record with the current correlation id
 * (from AsyncLocalStorage), so all logs for one request/trace are linkable.
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const sink = opts.sink ?? consoleSink;
  const now = opts.now ?? Date.now;
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>): void => {
    const record: LogRecord = {
      level,
      msg,
      time: new Date(now()).toISOString(),
      ...(opts.base ?? {}),
      ...(fields ?? {}),
    };
    const correlationId = getCorrelationId();
    if (correlationId) record.correlationId = correlationId;
    sink.write(record);
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}
