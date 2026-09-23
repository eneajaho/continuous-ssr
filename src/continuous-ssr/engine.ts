import { ApplicationRef } from '@angular/core';
import { Router } from '@angular/router';
import { ɵInlineCriticalCssProcessor as InlineCriticalCssProcessor } from '@angular/ssr';
import type { Subscription } from 'rxjs';
import { CONTINUOUS_RENDERING_OPTIONS, ContinuousRenderingOptions, discoverStaticRoutes } from './config';
import { Logger, NOOP_LOGGER, ms } from './log';
import { RenderLoop } from './render-loop';
import { ContinuousBootstrap, ContinuousRenderer } from './renderer';
import { SnapshotStore, SnapshotSummary } from './snapshot-store';

export interface ContinuousAppEngineOptions {
  /** The bootstrap function `main.server.ts` exports as default. */
  readonly bootstrap: ContinuousBootstrap;
  /** Contents of the built `index.server.html`. */
  readonly document: string;
  /** Origin the live application runs on, e.g. `http://localhost:4000`. */
  readonly origin: string;
  /**
   * Reads a built browser asset by file name, e.g. `styles-ABC123.css`, so critical CSS can be
   * inlined into snapshots. Omit to skip inlining.
   */
  readonly readBrowserAsset?: (fileName: string) => Promise<string>;
  readonly log?: Logger;
}

const DEFAULT_CACHE_CONTROL = 'public, max-age=0, s-maxage=5, stale-while-revalidate=30';
const DEFAULT_DEBOUNCE_MS = 50;

/**
 * The whole continuous-rendering pipeline behind one object: boots the application once,
 * keeps snapshots of its routes fresh, and answers requests from them.
 *
 * Which routes get snapshots and when they refresh comes from `provideContinuousRendering`
 * in the application's server config; nothing else needs to be wired.
 */
export class ContinuousAppEngine {
  private stability: Subscription | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    private readonly renderer: ContinuousRenderer,
    private readonly loop: RenderLoop,
    private readonly store: SnapshotStore,
    private readonly config: ContinuousRenderingOptions,
    private readonly log: Logger,
  ) {}

  static async start(options: ContinuousAppEngineOptions): Promise<ContinuousAppEngine> {
    const log = options.log ?? NOOP_LOGGER;
    const started = performance.now();

    const renderer = await ContinuousRenderer.create({
      bootstrap: options.bootstrap,
      document: options.document,
      url: `${options.origin}/`,
      log: log.child('renderer'),
    });

    const config = renderer.injector.get(CONTINUOUS_RENDERING_OPTIONS, null) ?? {};
    const routes =
      config.routes ?? discoverStaticRoutes(renderer.injector.get(Router, null)?.config ?? []);
    log.info('continuous rendering configured', {
      routes: routes.join(','),
      source: config.routes ? 'options' : 'router',
      autoRefresh: config.autoRefresh ?? true,
    });

    const criticalCss = options.readBrowserAsset
      ? new InlineCriticalCssProcessor((path) =>
          options.readBrowserAsset!(path.split('/').pop() ?? path),
        )
      : undefined;

    const store = new SnapshotStore();
    const loop = new RenderLoop({
      renderer,
      store,
      routes,
      postProcess: criticalCss ? (html) => criticalCss.process(html) : undefined,
      log: log.child('loop'),
    });
    await loop.refresh('warm-up');

    const engine = new ContinuousAppEngine(renderer, loop, store, config, log);
    if (config.autoRefresh ?? true) {
      engine.watchApplication();
    }
    log.info('continuous engine ready', {
      snapshots: store.size,
      version: loop.currentVersion,
      took: ms(performance.now() - started),
    });
    return engine;
  }

  /** Reaches services of the live application, e.g. to feed it data. */
  get injector() {
    return this.renderer.injector;
  }

  get version(): number {
    return this.loop.currentVersion;
  }

  get snapshots(): SnapshotSummary[] {
    return this.store.summaries();
  }

  /** Re-renders every route now. Only needed with `autoRefresh: false`. */
  refresh(reason = 'manual'): Promise<void> {
    return this.loop.refresh(reason);
  }

  /**
   * Answers a request from the snapshot store, or returns `null` when there is no snapshot
   * for its path so the caller can fall back to per-request rendering.
   */
  handle(request: Request): Response | null {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return null;
    }
    const path = new URL(request.url).pathname;
    const snapshot = this.store.get(path);
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
    this.stability?.unsubscribe();
    clearTimeout(this.refreshTimer);
    this.renderer.destroy();
  }

  /**
   * Re-renders whenever the application becomes stable again after a change of its own. The
   * renderer's own navigations also toggle stability; those are ignored while it is rendering.
   */
  private watchApplication(): void {
    const appRef = this.renderer.injector.get(ApplicationRef);
    const debounce = this.config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    let wasUnstable = false;

    this.stability = appRef.isStable.subscribe((stable) => {
      if (!stable) {
        wasUnstable = true;
        return;
      }
      if (!wasUnstable) {
        return;
      }
      wasUnstable = false;
      if (this.renderer.isRendering) {
        return;
      }
      this.log.debug('application changed, scheduling re-render', { debounce: ms(debounce) });
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => void this.loop.refresh('app-changed'), debounce);
      // Node timers keep the process alive unless unref'd; the DOM typings know nothing of it.
      (this.refreshTimer as unknown as { unref?: () => void }).unref?.();
    });
  }
}
