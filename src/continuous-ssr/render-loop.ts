import { Logger, NOOP_LOGGER, kb, ms } from './log';
import { SnapshotStore, etagFor } from './snapshot-store';

export interface RouteRenderer {
  render(url: string): Promise<string>;
}

export interface RenderLoopOptions {
  readonly renderer: RouteRenderer;
  readonly store: SnapshotStore;
  /** Pathnames to keep snapshots for. */
  readonly routes: readonly string[];
  /** Runs on every rendered document, e.g. to inline critical CSS. */
  readonly postProcess?: (html: string, path: string) => Promise<string> | string;
  readonly now?: () => string;
  readonly onError?: (error: unknown, path: string) => void;
  readonly log?: Logger;
}

/**
 * Re-renders every configured route into the snapshot store.
 *
 * `refresh()` calls that arrive while a run is in progress are coalesced into a single
 * follow-up run, so a burst of state changes costs at most two full passes.
 */
export class RenderLoop {
  private version = 0;
  private running: Promise<void> | null = null;
  private dirty = false;
  private pendingReasons: string[] = [];
  private readonly log: Logger;

  constructor(private readonly options: RenderLoopOptions) {
    this.log = options.log ?? NOOP_LOGGER;
  }

  /** Version of the most recently completed run. */
  get currentVersion(): number {
    return this.version;
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  /**
   * Renders all routes. Resolves once a run that started after this call has finished,
   * so the store reflects any state change made before calling it.
   *
   * @param reason Free text for the logs, e.g. `tick` or `api:message`.
   */
  refresh(reason = 'unspecified'): Promise<void> {
    if (this.running) {
      this.dirty = true;
      this.pendingReasons.push(reason);
      this.log.debug('refresh coalesced into the next run', { reason, queued: this.pendingReasons.length });
      return this.running;
    }
    this.pendingReasons = [reason];
    this.running = this.runUntilClean().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runUntilClean(): Promise<void> {
    do {
      this.dirty = false;
      const reasons = this.pendingReasons.join(',');
      this.pendingReasons = [];
      await this.renderAll(reasons);
    } while (this.dirty);
  }

  private async renderAll(reasons: string): Promise<void> {
    const { renderer, store, routes, postProcess, now, onError } = this.options;
    const version = this.version + 1;
    const started = performance.now();
    this.log.info('render run started', { version, routes: routes.length, reasons });

    let failures = 0;
    for (const path of routes) {
      const routeStarted = performance.now();
      try {
        const rendered = await renderer.render(path);
        const html = postProcess ? await postProcess(rendered, path) : rendered;
        const previous = store.get(path);
        const etag = etagFor(html);
        store.set({
          path,
          html,
          version,
          renderedAt: now ? now() : new Date().toISOString(),
          etag,
        });
        this.log.info('snapshot stored', {
          path,
          version,
          size: kb(html.length),
          changed: previous ? previous.etag !== etag : 'new',
          took: ms(performance.now() - routeStarted),
        });
      } catch (error) {
        failures++;
        this.log.error('snapshot failed, keeping the previous one', { path, version }, error);
        onError?.(error, path);
      }
    }

    this.version = version;
    this.log.info('render run finished', {
      version,
      snapshots: store.size,
      failures,
      took: ms(performance.now() - started),
      rerun: this.dirty,
    });
  }
}
