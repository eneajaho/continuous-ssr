import { DOCUMENT } from '@angular/common';
import {
  APP_ID,
  ApplicationRef,
  EnvironmentInjector,
  PlatformRef,
  StaticProvider,
  TransferState,
} from '@angular/core';
import type { BootstrapContext } from '@angular/platform-browser';
import {
  INITIAL_CONFIG,
  platformServer,
  ɵSERVER_CONTEXT as SERVER_CONTEXT,
  ɵrenderInternal as renderInternal,
} from '@angular/platform-server';
import { Router } from '@angular/router';
import { keepHttpTransferCacheActive } from './http-transfer-cache';
import { Logger, NOOP_LOGGER, kb, ms } from './log';
import { stripSerializationArtifacts } from './serialization-artifacts';
import { registeredSharedStateKeys } from './shared-state';
import { TransferStateScope, TransferStateStore, storeOf } from './transfer-state-scope';

export type ContinuousBootstrap = (context: BootstrapContext) => Promise<ApplicationRef>;

export interface ContinuousRendererOptions {
  /** The same bootstrap function `main.server.ts` exports. */
  readonly bootstrap: ContinuousBootstrap;
  /** The `index.server.html` template the app is rendered into. */
  readonly document: string;
  /** Absolute URL the application starts on. Its origin resolves relative render targets. */
  readonly url: string;
  readonly platformProviders?: readonly StaticProvider[];
  /** Value of the `ng-server-context` attribute on the root element. */
  readonly serverContext?: string;
  /**
   * `TransferState` keys that belong to every snapshot, on top of those created with
   * `makeSharedStateKey`. Everything else is attributed to the route that wrote it.
   */
  readonly sharedStateKeys?: readonly string[];
  readonly log?: Logger;
}

/**
 * Keeps one server platform and one `ApplicationRef` alive and serializes the live
 * application on demand, instead of bootstrapping and destroying it per request.
 *
 * Renders are queued so only one navigation-and-serialize cycle touches the DOM at a time.
 */
export class ContinuousRenderer {
  private queue: Promise<unknown> = Promise.resolve();
  private renders = 0;
  private rendering = 0;

  private constructor(
    private readonly platformRef: PlatformRef,
    private readonly appRef: ApplicationRef,
    private readonly origin: string,
    private readonly scope: TransferStateScope,
    private readonly log: Logger,
  ) {}

  static async create(options: ContinuousRendererOptions): Promise<ContinuousRenderer> {
    const log = options.log ?? NOOP_LOGGER;
    const started = performance.now();
    log.info('creating server platform', { url: options.url, template: kb(options.document.length) });

    const platformRef = platformServer([
      { provide: INITIAL_CONFIG, useValue: { document: options.document, url: options.url } },
      { provide: SERVER_CONTEXT, useValue: options.serverContext ?? 'ssr-continuous' },
      ...(options.platformProviders ?? []),
    ]);

    try {
      const appRef = await options.bootstrap({ platformRef });
      const bootstrapped = performance.now();
      log.info('application bootstrapped', { took: ms(bootstrapped - started) });

      await appRef.whenStable();
      log.info('application stable, keeping it alive', {
        took: ms(performance.now() - bootstrapped),
        components: appRef.components.length,
      });

      // Whatever the initial navigation wrote into TransferState belongs to the initial route.
      const scope = new TransferStateScope([
        ...(options.sharedStateKeys ?? []),
        ...registeredSharedStateKeys(),
      ]);
      const initial = new URL(options.url);
      const transferState = appRef.injector.get(TransferState, null);
      if (transferState) {
        const written = scope.attribute(
          storeOf(transferState),
          {},
          `${initial.pathname}${initial.search}${initial.hash}`,
        );
        log.debug('transfer state attributed to the initial route', { keys: written.join(',') });
      }

      return new ContinuousRenderer(platformRef, appRef, initial.origin, scope, log);
    } catch (error) {
      log.error('bootstrap failed, destroying platform', undefined, error);
      platformRef.destroy();
      throw error;
    }
  }

  /** The live application's environment injector, for reaching its services. */
  get injector(): EnvironmentInjector {
    return this.appRef.injector;
  }

  /** How many serializations have completed. */
  get renderCount(): number {
    return this.renders;
  }

  get destroyed(): boolean {
    return this.platformRef.destroyed;
  }

  /** Whether a navigate-and-serialize cycle is in progress. */
  get isRendering(): boolean {
    return this.rendering > 0;
  }

  /**
   * Navigates the live router to `url` when needed, waits for stability and serializes the
   * document. Resolves with the full HTML for that route.
   */
  render(url: string): Promise<string> {
    const queued = performance.now();
    const run = this.queue.then(() => {
      const waited = performance.now() - queued;
      if (waited > 1) {
        this.log.debug('render dequeued', { url, waited: ms(waited) });
      }
      this.rendering++;
      return this.renderNow(url).finally(() => {
        this.rendering--;
      });
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  destroy(): void {
    if (!this.platformRef.destroyed) {
      this.log.info('destroying platform', { renders: this.renders });
      this.platformRef.destroy();
    }
  }

  private async renderNow(url: string): Promise<string> {
    if (this.appRef.destroyed) {
      throw new Error('ContinuousRenderer has been destroyed.');
    }

    const started = performance.now();
    const injector = this.appRef.injector;
    const router = injector.get(Router, null);
    const transferState = injector.get(TransferState, null);
    const store = transferState ? storeOf(transferState) : undefined;
    const target = new URL(url, this.origin);
    const route = `${target.pathname}${target.search}${target.hash}`;
    let navigation: string | undefined;
    let evicted: string[] = [];
    let before: TransferStateStore = {};
    // Angular switches the HTTP transfer cache off after the first stabilization; this app
    // keeps rendering, so responses fetched from here on must still reach TransferState.
    const httpCache = keepHttpTransferCacheActive(injector);

    if (router && router.url !== route) {
      const from = router.url;
      // The route's components are about to be re-created; drop what they wrote last time so
      // they fetch fresh data instead of being answered from the transfer cache.
      evicted = store ? this.scope.evict(store, route) : [];
      // Everything written from here on, navigation included, belongs to this route.
      before = store ? this.scope.capture(store) : {};
      const navigated = await router.navigateByUrl(route);
      if (!navigated) {
        this.log.warn('navigation rejected', { from, to: route });
        throw new Error(`Navigation to ${route} was rejected.`);
      }
      navigation = `${from}->${route}`;
      this.log.debug('navigated live router', { from, to: route, took: ms(performance.now() - started) });
    }

    if (!navigation) {
      before = store ? this.scope.capture(store) : {};
    }
    const stripped = stripSerializationArtifacts(injector.get(DOCUMENT), injector.get(APP_ID));
    if (stripped.stateScript || stripped.markerComments || stripped.replayScripts) {
      this.log.debug('stripped previous serialization artifacts', {
        stateScript: stripped.stateScript,
        markerComments: stripped.markerComments,
        replayScripts: stripped.replayScripts,
      });
    }

    const beforeStable = performance.now();
    await this.appRef.whenStable();
    const stable = performance.now();

    const written = store ? this.scope.attribute(store, before, route) : [];
    const withheld = store ? this.scope.withhold(store, route) : {};
    let html: string;
    let serializedKeys: string[] = [];
    try {
      html = await renderInternal(this.platformRef, this.appRef);
      serializedKeys = store ? Object.keys(store) : [];
    } finally {
      if (store) {
        this.scope.restore(store, withheld);
      }
    }
    const serialized = performance.now();
    this.renders++;

    this.log.info('serialized live application', {
      url,
      render: this.renders,
      navigation,
      stable: ms(stable - beforeStable),
      serialize: ms(serialized - stable),
      total: ms(serialized - started),
      size: kb(html.length),
    });
    if (store) {
      this.log.debug('transfer state scoped', {
        route,
        evicted: evicted.length,
        written: written.length,
        withheld: Object.keys(withheld).length,
        httpCache: httpCache ? 'active' : 'absent',
        serialized: serializedKeys.join(','),
      });
    }

    return html;
  }
}
