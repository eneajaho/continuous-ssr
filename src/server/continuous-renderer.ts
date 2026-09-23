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
import { Logger, NOOP_LOGGER, kb, ms } from './log';
import { stripSerializationArtifacts } from './serialization-artifacts';

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

  private constructor(
    private readonly platformRef: PlatformRef,
    private readonly appRef: ApplicationRef,
    private readonly origin: string,
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
      return new ContinuousRenderer(platformRef, appRef, new URL(options.url).origin, log);
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
      return this.renderNow(url);
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
    let navigation: string | undefined;

    if (router) {
      const target = new URL(url, this.origin);
      const path = `${target.pathname}${target.search}${target.hash}`;
      if (router.url !== path) {
        const from = router.url;
        const navigated = await router.navigateByUrl(path);
        if (!navigated) {
          this.log.warn('navigation rejected', { from, to: path });
          throw new Error(`Navigation to ${path} was rejected.`);
        }
        navigation = `${from}->${path}`;
        this.log.debug('navigated live router', { from, to: path, took: ms(performance.now() - started) });
      }
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

    const html = await renderInternal(this.platformRef, this.appRef);
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
    this.logTransferStateKeys(injector);

    return html;
  }

  private logTransferStateKeys(injector: EnvironmentInjector): void {
    const transferState = injector.get(TransferState, null);
    if (!transferState || transferState.isEmpty) {
      return;
    }
    try {
      const keys = Object.keys(JSON.parse(transferState.toJson()) as Record<string, unknown>);
      this.log.debug('transfer state serialized', { keys: keys.length, names: keys.join(',') });
    } catch {
      // Only diagnostic; never let logging break a render.
    }
  }
}
