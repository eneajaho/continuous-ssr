import { ɵwithHttpTransferCache as withHttpTransferCache } from '@angular/common/http';
import { EnvironmentInjector, InjectionToken } from '@angular/core';

interface HttpTransferCacheState {
  isCacheActive: boolean;
}

let cacheOptionsToken: InjectionToken<HttpTransferCacheState> | null | undefined;

/**
 * Angular keeps the HTTP transfer cache's state behind an unexported token and switches the
 * cache off once the application first becomes stable. `withHttpTransferCache` is exported
 * (prefixed) and provides that token, so the token is recovered from the providers it returns:
 * it is the one whose factory produces the `{ isCacheActive }` state object. Token descriptions
 * are stripped from production builds, so the name cannot be used.
 */
export function findHttpTransferCacheToken(): InjectionToken<HttpTransferCacheState> | null {
  if (cacheOptionsToken !== undefined) {
    return cacheOptionsToken;
  }
  cacheOptionsToken = null;
  for (const provider of withHttpTransferCache({})) {
    const { provide, useFactory } = provider as { provide?: unknown; useFactory?: unknown };
    if (!(provide instanceof InjectionToken) || typeof useFactory !== 'function') {
      continue;
    }
    try {
      const produced: unknown = useFactory();
      if (typeof produced === 'object' && produced !== null && 'isCacheActive' in produced) {
        cacheOptionsToken = provide as InjectionToken<HttpTransferCacheState>;
        break;
      }
    } catch {
      // Not the provider we are looking for.
    }
  }
  return cacheOptionsToken;
}

/**
 * Re-enables the HTTP transfer cache of a long-lived application so responses fetched while
 * a route renders are written into `TransferState` again. Angular deactivates the cache after
 * the first stabilization because a per-request app never renders twice; this one does.
 *
 * Returns `false` when the app has no HTTP transfer cache to re-enable.
 */
export function keepHttpTransferCacheActive(injector: EnvironmentInjector): boolean {
  const token = findHttpTransferCacheToken();
  if (!token) {
    return false;
  }
  const state = injector.get(token, null);
  if (!state) {
    return false;
  }
  state.isCacheActive = true;
  return true;
}
