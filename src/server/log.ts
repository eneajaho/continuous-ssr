export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type LogFields = Record<string, string | number | boolean | undefined>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields, cause?: unknown): void;
  /** A logger whose lines carry `scope.child` as their scope. */
  child(scope: string): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

export function isLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && value in LEVEL_ORDER;
}

/** Formats a duration from `performance.now()` deltas, e.g. `12.3ms`. */
export function ms(duration: number): string {
  return duration >= 1000 ? `${(duration / 1000).toFixed(2)}s` : `${duration.toFixed(1)}ms`;
}

/** Formats a byte count, e.g. `41.2kB`. */
export function kb(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}kB` : `${bytes}B`;
}

function noop(): void {}

/** Logger for library code that was not given one. */
export const NOOP_LOGGER: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  child: () => NOOP_LOGGER,
};

export interface LogSink {
  log(line: string): void;
  error(line: string, cause?: unknown): void;
}

/**
 * Creates a logger that writes single-line entries such as
 * `14:12:17.093 info  [ssr.render] serialized route=/ stable=3.1ms size=41.2kB`.
 */
export function createLogger(scope: string, level: LogLevel = 'info', sink: LogSink = console): Logger {
  const threshold = LEVEL_ORDER[level];

  const write = (entryLevel: Exclude<LogLevel, 'silent'>, message: string, fields?: LogFields, cause?: unknown) => {
    if (LEVEL_ORDER[entryLevel] < threshold) {
      return;
    }
    const time = new Date().toISOString().slice(11, 23);
    const line = `${time} ${entryLevel.padEnd(5)} [${scope}] ${message}${formatFields(fields)}`;
    if (entryLevel === 'error') {
      sink.error(line, cause);
    } else {
      sink.log(line);
    }
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields, cause) => write('error', message, fields, cause),
    child: (childScope) => createLogger(`${scope}.${childScope}`, level, sink),
  };
}

function formatFields(fields: LogFields | undefined): string {
  if (!fields) {
    return '';
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    const text = String(value);
    parts.push(`${key}=${/[\s=]/.test(text) ? JSON.stringify(text) : text}`);
  }
  return parts.length ? `  ${parts.join(' ')}` : '';
}
