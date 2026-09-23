import { EnvironmentInjector, InjectionToken } from '@angular/core';
import { RenderMode, ServerRoute, withRoutes } from '@angular/ssr';

interface ServerRoutesConfig {
  readonly routes: readonly ServerRoute[];
}

let token: InjectionToken<ServerRoutesConfig> | null | undefined;

/**
 * Angular keeps the server routes (`provideServerRendering(withRoutes(...))`) behind an
 * unexported token; `withRoutes` is exported and provides it, so the token is recovered
 * from the providers it returns.
 */
export function findServerRoutesToken(): InjectionToken<ServerRoutesConfig> | null {
  if (token !== undefined) {
    return token;
  }
  token = null;
  for (const provider of withRoutes([]).ɵproviders) {
    const { provide, useValue } = provider as { provide?: unknown; useValue?: unknown };
    if (provide instanceof InjectionToken && typeof useValue === 'object' && useValue !== null && 'routes' in useValue) {
      token = provide as InjectionToken<ServerRoutesConfig>;
      break;
    }
  }
  return token;
}

/** The application's server routes, or an empty list when it has none. */
export function serverRoutesOf(injector: EnvironmentInjector): readonly ServerRoute[] {
  const found = findServerRoutesToken();
  return (found && injector.get(found, null)?.routes) ?? [];
}

/**
 * The server route that applies to `path`, with Angular's precedence: exact segments beat
 * parameters, which beat a trailing `**` wildcard. `undefined` when none matches.
 */
export function matchServerRoute(path: string, routes: readonly ServerRoute[]): ServerRoute | undefined {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  let best: { route: ServerRoute; score: number } | undefined;
  for (const route of routes) {
    const score = scoreRoute(segments, route.path.split('/').filter((segment) => segment.length > 0));
    if (score !== null && (best === undefined || score > best.score)) {
      best = { route, score };
    }
  }
  return best?.route;
}

/** Higher is more specific; `null` when the pattern does not match. */
function scoreRoute(segments: readonly string[], pattern: readonly string[]): number | null {
  let score = 0;
  for (let i = 0; i < pattern.length; i++) {
    const part = pattern[i];
    if (part === '**') {
      return score;
    }
    if (i >= segments.length) {
      return null;
    }
    if (part.startsWith(':')) {
      score += 1;
    } else if (part === segments[i]) {
      score += 2;
    } else {
      return null;
    }
  }
  return segments.length === pattern.length ? score + 1 : null;
}

/** Whether a path may be snapshotted according to its server route (none means yes). */
export function isServerRendered(path: string, routes: readonly ServerRoute[]): boolean {
  const matched = matchServerRoute(path, routes);
  return matched === undefined || matched.renderMode === RenderMode.Server;
}
