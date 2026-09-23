import { Logger, NOOP_LOGGER, kb, ms } from './log';
import { Snapshot, SnapshotStore, etagFor } from './snapshot-store';

export interface RouteRenderer {
  render(url: string): Promise<string>;
}

export type RouteList = readonly string[] | (() => Promise<readonly string[]> | readonly string[]);

export interface RenderLoopOptions {
  readonly renderer: RouteRenderer;
  readonly store: SnapshotStore;
  /** Pathnames to keep snapshots for, or a function that resolves them before each run. */
  readonly routes: RouteList;
  /** Runs on every rendered document, e.g. to inline critical CSS. */
  readonly postProcess?: (html: string, path: string) => Promise<string> | string;
  /** Called after a snapshot landed in the store, e.g. to purge a CDN. */
  readonly onSnapshotStored?: (snapshot: Snapshot) => void | Promise<void>;
  /** Called with paths that left the route list; their snapshots are already deleted. */
  readonly onRoutesDropped?: (paths: readonly string[]) => void;
  readonly now?: () => string;
  readonly onError?: (error: unknown, path: string) => void;
  readonly onRunFinished?: (stats: RenderRunStats) => void;
  /** Version numbering continues from here, so a replacement loop never goes backwards. */
  readonly initialVersion?: number;
  readonly log?: Logger;
}

export interface RenderRunStats {
  readonly version: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly routes: number;
  readonly failed: readonly string[];
  readonly reasons: string;
}

interface PendingRefresh {
  full: boolean;
  paths: Set<string>;
  reasons: string[];
}

/**
 * Renders routes into the snapshot store.
 *
 * `refresh()` calls that arrive while a run is in progress are coalesced into a single
 * follow-up run, so a burst of state changes costs at most two passes. A refresh may name
 * the paths it concerns; a full refresh subsumes any targeted ones queued with it.
 */
export class RenderLoop {
  private version = 0;
  private running: Promise<void> | null = null;
  private pending: PendingRefresh | null = null;
  private knownRoutes: readonly string[] = [];
  private lastRun: RenderRunStats | undefined;
  private consecutiveFailedRuns = 0;
  private stopped = false;
  private readonly log: Logger;

  constructor(private readonly options: RenderLoopOptions) {
    this.log = options.log ?? NOOP_LOGGER;
    this.version = options.initialVersion ?? 0;
  }

  /** Version of the most recently completed run. */
  get currentVersion(): number {
    return this.version;
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  /** The routes the last run rendered. */
  get routes(): readonly string[] {
    return this.knownRoutes;
  }

  get stats(): { lastRun: RenderRunStats | undefined; consecutiveFailedRuns: number } {
    return { lastRun: this.lastRun, consecutiveFailedRuns: this.consecutiveFailedRuns };
  }

  /**
   * Renders routes. Resolves once a run that started after this call has finished, so the
   * store reflects any state change made before calling it.
   *
   * @param reason Free text for the logs, e.g. `tick` or `api:message`.
   * @param paths Only these routes; omit for all of them.
   */
  refresh(reason = 'unspecified', paths?: readonly string[]): Promise<void> {
    if (this.stopped) {
      this.log.debug('refresh ignored, loop is stopped', { reason });
      return this.running ?? Promise.resolve();
    }
    const pending = (this.pending ??= { full: false, paths: new Set(), reasons: [] });
    pending.reasons.push(reason);
    if (paths) {
      for (const path of paths) {
        pending.paths.add(path);
      }
    } else {
      pending.full = true;
    }

    if (this.running) {
      this.log.debug('refresh coalesced into the next run', { reason, queued: pending.reasons.length });
      return this.running;
    }
    this.running = this.runUntilClean().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Resolves once no run is in progress. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /** Refuses new runs; the current one, if any, finishes. */
  stop(): void {
    this.stopped = true;
    this.pending = null;
  }

  /** Moves the version forward so a replacement loop never reuses a number. */
  bumpVersionTo(version: number): void {
    this.version = Math.max(this.version, version);
  }

  private async runUntilClean(): Promise<void> {
    while (this.pending) {
      const batch = this.pending;
      this.pending = null;
      await this.renderBatch(batch);
    }
  }

  private async renderBatch(batch: PendingRefresh): Promise<void> {
    const { renderer, store, postProcess, onSnapshotStored, onRoutesDropped, now, onError } = this.options;
    const version = this.version + 1;
    const startedAt = now ? now() : new Date().toISOString();
    const started = performance.now();
    const reasons = batch.reasons.join(',');

    const all = await this.resolveRoutes();
    const dropped = this.knownRoutes.filter((path) => !all.includes(path));
    const added = all.filter((path) => !this.knownRoutes.includes(path));
    this.knownRoutes = all;
    for (const path of dropped) {
      await store.delete(path);
    }
    if (dropped.length) {
      this.log.info('routes dropped, snapshots deleted', { paths: dropped.join(',') });
      onRoutesDropped?.(dropped);
    }

    const targets = batch.full
      ? all
      : all.filter((path) => batch.paths.has(path) || added.includes(path));
    const ignored = batch.full ? [] : Array.from(batch.paths).filter((path) => !all.includes(path));
    if (ignored.length) {
      this.log.warn('refresh asked for paths that are not snapshot routes', { paths: ignored.join(',') });
    }
    this.log.info('render run started', {
      version,
      routes: targets.length,
      of: all.length,
      scope: batch.full ? 'all' : 'targeted',
      reasons,
    });

    const failed: string[] = [];
    for (const path of targets) {
      const routeStarted = performance.now();
      try {
        const rendered = await renderer.render(path);
        const html = postProcess ? await postProcess(rendered, path) : rendered;
        const previous = await store.get(path);
        const etag = etagFor(html);
        const snapshot: Snapshot = {
          path,
          html,
          version,
          renderedAt: now ? now() : new Date().toISOString(),
          etag,
        };
        await store.set(snapshot);
        this.log.info('snapshot stored', {
          path,
          version,
          size: kb(html.length),
          changed: previous ? previous.etag !== etag : 'new',
          took: ms(performance.now() - routeStarted),
        });
        await onSnapshotStored?.(snapshot);
      } catch (error) {
        failed.push(path);
        this.log.error('snapshot failed, keeping the previous one', { path, version }, error);
        onError?.(error, path);
      }
    }

    this.version = version;
    this.consecutiveFailedRuns = targets.length > 0 && failed.length === targets.length ? this.consecutiveFailedRuns + 1 : 0;
    this.lastRun = {
      version,
      startedAt,
      finishedAt: now ? now() : new Date().toISOString(),
      routes: targets.length,
      failed,
      reasons,
    };
    this.log.info('render run finished', {
      version,
      snapshots: all.length,
      failures: failed.length,
      took: ms(performance.now() - started),
      rerun: this.pending !== null,
    });
    this.options.onRunFinished?.(this.lastRun);
  }

  private async resolveRoutes(): Promise<readonly string[]> {
    const { routes } = this.options;
    const resolved = typeof routes === 'function' ? await routes() : routes;
    return Array.from(new Set(resolved));
  }
}
