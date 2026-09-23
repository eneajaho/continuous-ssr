import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { Routes } from '@angular/router';

export interface ContinuousRenderingOptions {
  /**
   * Pathnames to keep snapshots for. Defaults to every static route in the router config
   * (no parameters, no wildcards, no lazily loaded children).
   */
  readonly routes?: readonly string[];
  /**
   * Re-render snapshots whenever the live application settles after a change of its own,
   * such as a signal written by a service. Default `true`.
   */
  readonly autoRefresh?: boolean;
  /** Quiet time after the last change before an automatic re-render starts. Default 50ms. */
  readonly debounceMs?: number;
  /** `Cache-Control` header on snapshot responses. */
  readonly cacheControl?: string;
  /**
   * Re-render everything on a timer regardless of detected changes, as a safety net for
   * changes the application cannot see. Off by default.
   */
  readonly refreshIntervalMs?: number;
  /**
   * When to replace the live application with a fresh one. A long-lived app accumulates
   * whatever its services leak; recycling bounds that. Checked after every render run.
   */
  readonly recycle?: RecyclePolicy;
}

export interface RecyclePolicy {
  /** Recycle once the instance has produced this many renders. */
  readonly afterRenders?: number;
  /** Recycle once the instance is this old. */
  readonly afterMs?: number;
  /** Recycle once the process heap exceeds this many megabytes. */
  readonly maxHeapMb?: number;
}

export const CONTINUOUS_RENDERING_OPTIONS = new InjectionToken<ContinuousRenderingOptions>(
  'CONTINUOUS_RENDERING_OPTIONS',
);

/**
 * Opts the application into continuous rendering and configures it. Add it to the server
 * providers next to `provideServerRendering`. Every option has a default, so a bare
 * `provideContinuousRendering()` is enough.
 */
export function provideContinuousRendering(options: ContinuousRenderingOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: CONTINUOUS_RENDERING_OPTIONS, useValue: options }]);
}

/**
 * Collects the pathnames of routes that can be rendered without input: static paths that lead
 * to a component. Parameterised paths, wildcards, redirects and lazily loaded child configs
 * are skipped; list those explicitly in `routes` when they should get snapshots.
 */
export function discoverStaticRoutes(routes: Routes, prefix = ''): string[] {
  const found: string[] = [];
  for (const route of routes) {
    const path = route.path ?? '';
    if (path.includes(':') || path.includes('*')) {
      continue;
    }
    const full = [prefix, path].filter((segment) => segment.length > 0).join('/');
    if (route.component || route.loadComponent) {
      found.push(`/${full}`);
    }
    if (route.children) {
      found.push(...discoverStaticRoutes(route.children, full));
    }
  }
  return Array.from(new Set(found));
}
