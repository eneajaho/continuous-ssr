import { LogSink, createLogger, kb, ms } from './log';

class MemorySink implements LogSink {
  readonly lines: string[] = [];
  readonly errors: unknown[] = [];
  log(line: string): void {
    this.lines.push(line);
  }
  error(line: string, cause?: unknown): void {
    this.lines.push(line);
    this.errors.push(cause);
  }
}

describe('createLogger', () => {
  it('writes one line with time, level, scope, message and fields', () => {
    const sink = new MemorySink();
    const log = createLogger('ssr', 'info', sink);

    log.info('snapshot stored', { path: '/', version: 3, changed: true, skipped: undefined });

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toMatch(
      /^\d{2}:\d{2}:\d{2}\.\d{3} info {2}\[ssr\] snapshot stored {2}path=\/ version=3 changed=true$/,
    );
  });

  it('quotes values that contain spaces or equals signs', () => {
    const sink = new MemorySink();
    createLogger('ssr', 'info', sink).info('changed', { message: 'hello world', pair: 'a=b' });

    expect(sink.lines[0]).toContain('message="hello world" pair="a=b"');
  });

  it('drops entries below the configured level', () => {
    const sink = new MemorySink();
    const log = createLogger('ssr', 'warn', sink);

    log.debug('hidden');
    log.info('hidden');
    log.warn('shown');

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toContain('warn  [ssr] shown');
  });

  it('routes errors with their cause to the error sink and nests child scopes', () => {
    const sink = new MemorySink();
    const cause = new Error('boom');

    createLogger('ssr', 'debug', sink).child('loop').error('failed', { path: '/' }, cause);

    expect(sink.lines[0]).toContain('error [ssr.loop] failed  path=/');
    expect(sink.errors).toEqual([cause]);
  });

  it('is silent at level silent', () => {
    const sink = new MemorySink();
    createLogger('ssr', 'silent', sink).error('nothing');

    expect(sink.lines).toHaveLength(0);
  });
});

describe('formatting helpers', () => {
  it('formats durations and sizes', () => {
    expect(ms(12.34)).toBe('12.3ms');
    expect(ms(1500)).toBe('1.50s');
    expect(kb(512)).toBe('512B');
    expect(kb(42_188)).toBe('41.2kB');
  });
});
