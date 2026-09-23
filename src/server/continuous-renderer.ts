import { DOCUMENT } from '@angular/common';
import {
  APP_ID,
  ApplicationRef,
  EnvironmentInjector,
  PlatformRef,
  StaticProvider,
} from '@angular/core';
import type { BootstrapContext } from '@angular/platform-browser';
import {
  INITIAL_CONFIG,
  platformServer,
  ɵSERVER_CONTEXT as SERVER_CONTEXT,
  ɵrenderInternal as renderInternal,
} from '@angular/platform-server';
import { Router } from '@angular/router';
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
  ) {}

  static async create(options: ContinuousRendererOptions): Promise<ContinuousRenderer> {
    const platformRef = platformServer([
      { provide: INITIAL_CONFIG, useValue: { document: options.document, url: options.url } },
      { provide: SERVER_CONTEXT, useValue: options.serverContext ?? 'ssr-continuous' },
      ...(options.platformProviders ?? []),
    ]);

    try {
      const appRef = await options.bootstrap({ platformRef });
      await appRef.whenStable();
      return new ContinuousRenderer(platformRef, appRef, new URL(options.url).origin);
    } catch (error) {
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
    const run = this.queue.then(() => this.renderNow(url));
    this.queue = run.catch(() => undefined);
    return run;
  }

  destroy(): void {
    if (!this.platformRef.destroyed) {
      this.platformRef.destroy();
    }
  }

  private async renderNow(url: string): Promise<string> {
    if (this.appRef.destroyed) {
      throw new Error('ContinuousRenderer has been destroyed.');
    }

    const injector = this.appRef.injector;
    const router = injector.get(Router, null);
    if (router) {
      const target = new URL(url, this.origin);
      const path = `${target.pathname}${target.search}${target.hash}`;
      if (router.url !== path) {
        const navigated = await router.navigateByUrl(path);
        if (!navigated) {
          throw new Error(`Navigation to ${path} was rejected.`);
        }
      }
    }

    stripSerializationArtifacts(injector.get(DOCUMENT), injector.get(APP_ID));
    await this.appRef.whenStable();

    const html = await renderInternal(this.platformRef, this.appRef);
    this.renders++;
    return html;
  }
}
