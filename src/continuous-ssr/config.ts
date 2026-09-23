import {
  EnvironmentInjector,
  EnvironmentProviders,
  InjectionToken,
  makeEnvironmentProviders,
  runInInjectionContext,
} from '@angular/core';
import { Router, Routes } from '@angular/router';

export type RouteParams = Readonly<Record<string, string>>;

export interface ParameterisedRoute {
  /** A route path with parameters, e.g. `news/:id`. */
  readonly path: string;
  /**
   * Produces one params object per instance to snapshot, e.g. `[{ id: '1' }, { id: '2' }]`.
   * Runs inside the live application's injection context before every render run, so it can
   * `inject()` services; whatever it writes to `TransferState` is discarded.
   */
  readonly params: () => Promise<readonly RouteParams[]> | readonly RouteParams[];
}

export interface ContinuousRenderingOptions {
  /**
   * Routes to snapshot on top of the discovered ones: static paths, or parameterised routes
   * expanded through their `params` function before every run.
   */
  readonly routes?: readonly (string | ParameterisedRoute)[];
  /**
   * Discover every static route in the router config (no parameters, no wildcards, no lazily
   * loaded children). Default `true`.
   */
  readonly discoverRoutes?: boolean;
  /** Paths that never get a snapshot: exact strings or patterns. */
  readonly exclude?: readonly (string | RegExp)[];
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

/** Fills the parameters of `path` from `params`, e.g. `news/:id` + `{ id: '7' }` → `/news/7`. */
export function expandRoute(path: string, params: RouteParams): string {
  const filled = path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (!segment.startsWith(':')) {
        return segment;
      }
      const value = params[segment.slice(1)];
      if (value === undefined) {
        throw new Error(`Route "${path}" needs a "${segment.slice(1)}" parameter.`);
      }
      return encodeURIComponent(value);
    });
  return `/${filled.join('/')}`;
}

export function isExcluded(path: string, exclude: readonly (string | RegExp)[] = []): boolean {
  return exclude.some((rule) => (typeof rule === 'string' ? rule === path : rule.test(path)));
}

/**
 * The full list of paths to snapshot right now: discovered static routes, explicit paths and
 * expanded parameterised routes, minus exclusions. `runParams` runs a params function; the
 * engine uses it to discard transfer state the function leaves behind.
 */
export async function resolveSnapshotRoutes(
  injector: EnvironmentInjector,
  options: ContinuousRenderingOptions,
  runParams: <T>(fn: () => Promise<T> | T) => Promise<T> = (fn) =>
    runInInjectionContext(injector, () => Promise.resolve(fn())),
): Promise<string[]> {
  const paths: string[] = [];
  if (options.discoverRoutes ?? true) {
    paths.push(...discoverStaticRoutes(injector.get(Router, null)?.config ?? []));
  }
  for (const route of options.routes ?? []) {
    if (typeof route === 'string') {
      paths.push(route.startsWith('/') ? route : `/${route}`);
      continue;
    }
    const instances = await runParams(() => runInInjectionContext(injector, () => route.params()));
    for (const params of instances) {
      paths.push(expandRoute(route.path, params));
    }
  }
  return Array.from(new Set(paths)).filter((path) => !isExcluded(path, options.exclude));
}
