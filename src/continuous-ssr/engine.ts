import { ApplicationRef, EnvironmentInjector } from '@angular/core';
import { ɵInlineCriticalCssProcessor as InlineCriticalCssProcessor } from '@angular/ssr';
import type { Subscription } from 'rxjs';
import {
  CONTINUOUS_RENDERING_OPTIONS,
  ContinuousRenderingOptions,
  RecyclePolicy,
  resolveSnapshotRoutes,
} from './config';
import { Logger, NOOP_LOGGER, ms } from './log';
import { RenderLoop, RenderRunStats } from './render-loop';
import { ContinuousBootstrap, ContinuousRenderer } from './renderer';
import { RouteDependencyTracker } from './route-dependencies';
import { registeredSharedSignals } from './shared-state';
import { MemorySnapshotStore, Snapshot, SnapshotStore, SnapshotSummary } from './snapshot-store';

export interface ContinuousAppEngineOptions {
  /** The bootstrap function `main.server.ts` exports as default. */
  readonly bootstrap: ContinuousBootstrap;
  /** Contents of the built `index.server.html`. */
  readonly document: string;
  /** Origin the live application runs on, e.g. `http://localhost:4000`. */
  readonly origin: string;
  /**
   * `render` (default) boots the application and keeps the store fresh; `serve` only answers
   * requests from a store that another instance fills, for horizontal scaling behind one
   * shared `SnapshotStore`.
   */
  readonly role?: 'render' | 'serve';
  /** Where snapshots live. Defaults to an in-memory store for this process. */
  readonly store?: SnapshotStore;
  /**
   * Runs for every fresh live application, at start and after each recycle, before its first
   * snapshots. Seed state or open data feeds here; services that fetch their own data on
   * bootstrap need nothing.
   */
  readonly prepare?: (injector: EnvironmentInjector) => void | Promise<void>;
  /** Called after each snapshot lands in the store, e.g. to purge a CDN path. */
  readonly onSnapshotStored?: (snapshot: Snapshot) => void | Promise<void>;
  /**
   * Decides per request whether a snapshot may answer it. Snapshots are the same for every
   * visitor, so return `false` for requests that need a personal render, such as ones carrying
   * a session cookie; they fall through to per-request rendering. Default: always `true`.
   */
  readonly shouldServeSnapshot?: (request: Request) => boolean;
  /**
   * Reads a built browser asset by file name, e.g. `styles-ABC123.css`, so critical CSS can be
   * inlined into snapshots. Omit to skip inlining.
   */
  readonly readBrowserAsset?: (fileName: string) => Promise<string>;
  readonly log?: Logger;
}

export interface EngineHealth {
  /** Snapshots exist and rendering is not failing outright. */
  readonly ok: boolean;
  readonly role: 'render' | 'serve';
  readonly version: number;
  readonly instance?: {
    readonly startedAt: string;
    readonly ageMs: number;
    readonly renders: number;
    readonly recycles: number;
    readonly recycling: boolean;
  };
  readonly lastRun?: RenderRunStats;
  readonly consecutiveFailedRuns: number;
  readonly heapUsedMb?: number;
  readonly snapshots: readonly (SnapshotSummary & { readonly ageMs: number })[];
}

/** One live application with its render loop. Replaced wholesale on recycle. */
interface LiveInstance {
  readonly renderer: ContinuousRenderer;
  readonly loop: RenderLoop;
  readonly tracker: RouteDependencyTracker | undefined;
  readonly startedAt: number;
  stability: Subscription | undefined;
  /** Why the next automatic refresh was requested, for the logs. */
  pendingReasons: Set<string>;
}

const DEFAULT_CACHE_CONTROL = 'public, max-age=0, s-maxage=5, stale-while-revalidate=30';
const DEFAULT_DEBOUNCE_MS = 50;
const UNHEALTHY_AFTER_FAILED_RUNS = 3;

/**
 * The whole continuous-rendering pipeline behind one object: boots the application once,
 * keeps snapshots of its routes fresh, and answers requests from them.
 *
 * Which routes get snapshots and when they refresh comes from `provideContinuousRendering`
 * in the application's server config; nothing else needs to be wired.
 */
export class ContinuousAppEngine {
  private instance: LiveInstance | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private intervalTimer: ReturnType<typeof setInterval> | undefined;
  private recycles = 0;
  private recycling: Promise<void> | undefined;
  private stopped = false;

  private constructor(
    private readonly options: ContinuousAppEngineOptions,
    private readonly store: SnapshotStore,
    private readonly log: Logger,
  ) {}

  static async start(options: ContinuousAppEngineOptions): Promise<ContinuousAppEngine> {
    const log = options.log ?? NOOP_LOGGER;
    const store = options.store ?? new MemorySnapshotStore();
    const engine = new ContinuousAppEngine(options, store, log);

    if (options.role === 'serve') {
      log.info('serving snapshots only; another instance renders them', {
        snapshots: (await store.summaries()).length,
      });
      return engine;
    }

    const started = performance.now();
    engine.instance = await engine.createInstance(0);
    engine.watchApplication(engine.instance);
    engine.startInterval();
    log.info('continuous engine ready', {
      snapshots: (await store.summaries()).length,
      version: engine.version,
      took: ms(performance.now() - started),
    });
    return engine;
  }

  /** Reaches services of the live application, e.g. to feed it data. Render role only. */
  get injector(): EnvironmentInjector {
    if (!this.instance) {
      throw new Error('This engine only serves snapshots; there is no live application.');
    }
    return this.instance.renderer.injector;
  }

  get role(): 'render' | 'serve' {
    return this.instance ? 'render' : 'serve';
  }

  get version(): number {
    return this.instance?.loop.currentVersion ?? 0;
  }

  /** Effective options, as provided by `provideContinuousRendering` in the app. */
  get config(): ContinuousRenderingOptions {
    return this.instance?.renderer.injector.get(CONTINUOUS_RENDERING_OPTIONS, null) ?? {};
  }

  snapshots(): Promise<SnapshotSummary[]> {
    return this.store.summaries();
  }

  async health(): Promise<EngineHealth> {
    const now = Date.now();
    const snapshots = (await this.store.summaries()).map((summary) => ({
      ...summary,
      ageMs: now - Date.parse(summary.renderedAt),
    }));
    const stats = this.instance?.loop.stats;
    const instance = this.instance
      ? {
          startedAt: new Date(this.instance.startedAt).toISOString(),
          ageMs: now - this.instance.startedAt,
          renders: this.instance.renderer.renderCount,
          recycles: this.recycles,
          recycling: this.recycling !== undefined,
        }
      : undefined;
    const consecutiveFailedRuns = stats?.consecutiveFailedRuns ?? 0;
    return {
      ok: snapshots.length > 0 && consecutiveFailedRuns < UNHEALTHY_AFTER_FAILED_RUNS,
      role: this.role,
      version: this.version,
      instance,
      lastRun: stats?.lastRun,
      consecutiveFailedRuns,
      heapUsedMb: heapUsedMb(),
      snapshots,
    };
  }

  /**
   * Re-renders routes now: all of them, or only `paths`. Needed for changes the application
   * cannot see, such as an external API behind a webhook, or with `autoRefresh: false`.
   */
  refresh(reason = 'manual', paths?: readonly string[]): Promise<void> {
    if (!this.instance) {
      return Promise.reject(new Error('This engine only serves snapshots; it cannot render.'));
    }
    return this.instance.loop.refresh(reason, paths);
  }

  /**
   * Replaces the live application with a freshly bootstrapped one. The new instance is
   * prepared and warmed up in the background while the old one keeps serving; then they swap
   * and the old one is destroyed. Concurrent calls share one recycle.
   */
  recycle(reason = 'manual'): Promise<void> {
    if (!this.instance) {
      return Promise.reject(new Error('This engine only serves snapshots; there is nothing to recycle.'));
    }
    this.recycling ??= this.recycleNow(reason).finally(() => {
      this.recycling = undefined;
    });
    return this.recycling;
  }

  /**
   * Answers a request from the snapshot store, or resolves `null` when there is no snapshot
   * for its path so the caller can fall back to per-request rendering.
   */
  async handle(request: Request): Promise<Response | null> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return null;
    }
    const path = new URL(request.url).pathname;
    if (this.options.shouldServeSnapshot && !this.options.shouldServeSnapshot(request)) {
      this.log.info('request bypasses snapshots', { path, mode: 'per-request' });
      return null;
    }
    const snapshot = await this.store.get(path);
    if (!snapshot) {
      return null;
    }

    const headers = new Headers({
      'Content-Type': 'text/html; charset=utf-8',
      ETag: snapshot.etag,
      'Cache-Control': this.config.cacheControl ?? DEFAULT_CACHE_CONTROL,
      'X-SSR-Mode': 'continuous',
      'X-SSR-Version': String(snapshot.version),
      'X-SSR-Rendered-At': snapshot.renderedAt,
    });

    if (request.headers.get('if-none-match') === snapshot.etag) {
      this.log.info('request served', { path, mode: 'continuous', status: 304, version: snapshot.version });
      return new Response(null, { status: 304, headers });
    }
    this.log.info('request served', {
      path,
      mode: 'continuous',
      status: 200,
      version: snapshot.version,
      age: ms(Date.now() - Date.parse(snapshot.renderedAt)),
    });
    return new Response(request.method === 'HEAD' ? null : snapshot.html, { status: 200, headers });
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.refreshTimer);
    clearInterval(this.intervalTimer);
    if (this.instance) {
      this.instance.stability?.unsubscribe();
      this.instance.tracker?.destroy();
      this.instance.renderer.destroy();
      this.instance = undefined;
    }
  }

  private async createInstance(initialVersion: number): Promise<LiveInstance> {
    const { options, store, log } = this;
    const renderer = await ContinuousRenderer.create({
      bootstrap: options.bootstrap,
      document: options.document,
      url: `${options.origin}/`,
      log: log.child('renderer'),
    });

    const config = renderer.injector.get(CONTINUOUS_RENDERING_OPTIONS, null) ?? {};
    const routes = () =>
      resolveSnapshotRoutes(renderer.injector, config, (fn) => renderer.withoutTransferState(fn));
    log.info('continuous rendering configured', {
      routes: (await routes()).join(','),
      discover: config.discoverRoutes ?? true,
      explicit: (config.routes ?? []).length,
      autoRefresh: config.autoRefresh ?? true,
      store: store.constructor.name,
    });

    if (options.prepare) {
      const prepared = performance.now();
      await options.prepare(renderer.injector);
      log.debug('application prepared', { took: ms(performance.now() - prepared) });
    }

    const criticalCss = options.readBrowserAsset
      ? new InlineCriticalCssProcessor((path) =>
          options.readBrowserAsset!(path.split('/').pop() ?? path),
        )
      : undefined;

    const instance: LiveInstance = {
      renderer,
      loop: undefined as unknown as RenderLoop,
      tracker: undefined,
      startedAt: Date.now(),
      stability: undefined,
      pendingReasons: new Set(),
    };
    const tracker =
      (config.granular ?? true) && (config.autoRefresh ?? true)
        ? new RouteDependencyTracker({
            appRef: renderer.injector.get(ApplicationRef),
            isRendering: () => renderer.isRendering,
            sharedSignals: registeredSharedSignals,
            onDirty: (route) => this.scheduleRefresh(instance, route === null ? 'shared-state' : `dependency:${route}`),
            log: log.child('deps'),
          })
        : undefined;

    const loop = new RenderLoop({
      renderer,
      store,
      routes,
      initialVersion,
      postProcess: criticalCss ? (html) => criticalCss.process(html) : undefined,
      afterRender: tracker
        ? (path) => {
            const producers = tracker.track(path);
            log.debug('route dependencies tracked', { path, producers });
          }
        : undefined,
      onSnapshotStored: options.onSnapshotStored,
      onRoutesDropped: (paths) =>
        paths.forEach((path) => {
          renderer.forgetRoute(path);
          tracker?.untrack(path);
        }),
      onRunFinished: () => this.checkRecyclePolicy(config.recycle),
      log: log.child('loop'),
    });
    Object.assign(instance, { loop, tracker });
    await loop.refresh('warm-up');
    // Marks made while warming up came from the warm-up itself.
    tracker?.takeDirty();

    return instance;
  }

  /**
   * Debounced automatic refresh. When it fires, the dependency tracker decides its scope:
   * only the routes whose dependencies changed, or everything after a shared-state change or
   * a change nobody could attribute.
   */
  private scheduleRefresh(instance: LiveInstance, reason: string): void {
    if (this.stopped || instance !== this.instance) {
      return;
    }
    instance.pendingReasons.add(reason);
    const debounce = this.config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      const reasons = Array.from(instance.pendingReasons).join('+');
      instance.pendingReasons.clear();
      const dirty = instance.tracker?.supported ? instance.tracker.takeDirty() : null;
      if (dirty === null) {
        void instance.loop.refresh(reasons);
      } else if (dirty.length > 0) {
        void instance.loop.refresh(reasons, dirty);
      } else {
        // Stability toggled but no tracked dependency changed: something unattributed.
        void instance.loop.refresh(`${reasons}:unattributed`);
      }
    }, debounce);
    // Node timers keep the process alive unless unref'd; the DOM typings know nothing of it.
    (this.refreshTimer as unknown as { unref?: () => void }).unref?.();
  }

  private async recycleNow(reason: string): Promise<void> {
    const old = this.instance!;
    const started = performance.now();
    this.log.info('recycling live application', { reason, renders: old.renderer.renderCount });

    const fresh = await this.createInstance(old.loop.currentVersion);
    if (this.stopped) {
      fresh.renderer.destroy();
      return;
    }

    // Stop the old instance first: no new runs, wait for one in flight, then swap.
    old.loop.stop();
    old.stability?.unsubscribe();
    old.tracker?.destroy();
    clearTimeout(this.refreshTimer);
    await old.loop.idle();
    this.instance = fresh;
    this.recycles++;
    this.watchApplication(fresh);
    old.renderer.destroy();
    // The old instance may have written snapshots while the fresh one warmed up; render once
    // more so the store reflects the fresh instance with a version past everything before.
    fresh.loop.bumpVersionTo(old.loop.currentVersion);
    await fresh.loop.refresh('recycled');
    this.log.info('live application recycled', {
      recycles: this.recycles,
      version: fresh.loop.currentVersion,
      took: ms(performance.now() - started),
    });
  }

  private checkRecyclePolicy(policy: RecyclePolicy | undefined): void {
    const instance = this.instance;
    if (!policy || !instance || this.recycling || this.stopped) {
      return;
    }
    let reason: string | undefined;
    if (policy.afterRenders !== undefined && instance.renderer.renderCount >= policy.afterRenders) {
      reason = `renders>=${policy.afterRenders}`;
    } else if (policy.afterMs !== undefined && Date.now() - instance.startedAt >= policy.afterMs) {
      reason = `age>=${ms(policy.afterMs)}`;
    } else if (policy.maxHeapMb !== undefined && (heapUsedMb() ?? 0) >= policy.maxHeapMb) {
      reason = `heap>=${policy.maxHeapMb}MB`;
    }
    if (reason) {
      void this.recycle(reason).catch((error) =>
        this.log.error('recycle failed; keeping the current instance', { reason }, error),
      );
    }
  }

  private startInterval(): void {
    const interval = this.config.refreshIntervalMs;
    if (!interval || interval <= 0) {
      return;
    }
    this.intervalTimer = setInterval(() => void this.instance?.loop.refresh('interval'), interval);
    (this.intervalTimer as unknown as { unref?: () => void }).unref?.();
    this.log.info('periodic refresh enabled', { every: ms(interval) });
  }

  /**
   * Re-renders whenever the application becomes stable again after a change of its own. The
   * renderer's own navigations also toggle stability; those are ignored while it is rendering.
   */
  private watchApplication(instance: LiveInstance): void {
    if (!(this.config.autoRefresh ?? true)) {
      return;
    }
    const appRef = instance.renderer.injector.get(ApplicationRef);
    let wasUnstable = false;

    instance.stability = appRef.isStable.subscribe((stable) => {
      if (!stable) {
        wasUnstable = true;
        return;
      }
      if (!wasUnstable) {
        return;
      }
      wasUnstable = false;
      if (instance.renderer.isRendering) {
        return;
      }
      this.log.debug('application settled after a change');
      this.scheduleRefresh(instance, 'app-changed');
    });
  }
}

function heapUsedMb(): number | undefined {
  const memory = (globalThis as { process?: { memoryUsage?: () => { heapUsed: number } } }).process
    ?.memoryUsage;
  return memory ? Math.round(memory().heapUsed / 1024 / 1024) : undefined;
}
