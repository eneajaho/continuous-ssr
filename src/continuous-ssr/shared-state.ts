import { isPlatformServer } from '@angular/common';
import {
  PLATFORM_ID,
  StateKey,
  TransferState,
  WritableSignal,
  effect,
  inject,
  makeStateKey,
  signal,
} from '@angular/core';

const registry = new Set<string>();

/**
 * Creates a `TransferState` key for app-wide state: state a root service mirrors into the
 * store that every page needs, as opposed to data one route fetched for itself.
 *
 * Keys made here travel with every snapshot the continuous renderer produces. Keys made with
 * Angular's `makeStateKey` (and the HTTP transfer cache's own keys) travel only with the route
 * that wrote them. Prefer `sharedState`, which also handles the mirroring.
 */
export function makeSharedStateKey<T>(name: string): StateKey<T> {
  registry.add(name);
  return makeStateKey<T>(name);
}

/** Names of every key created with `makeSharedStateKey` or `sharedState`. */
export function registeredSharedStateKeys(): readonly string[] {
  return Array.from(registry);
}

/**
 * A writable signal for app-wide live state. Call it inside a service or component
 * (an injection context).
 *
 * - On the server every write is mirrored into `TransferState` under `name`, which also lets
 *   the continuous engine notice the change and re-render the snapshots.
 * - In the browser the signal starts from the transferred value, so hydration matches.
 * - The key is shared, so every route's snapshot carries it.
 *
 * ```ts
 * @Service()
 * export class LiveDataStore {
 *   private readonly state = sharedState<LiveState>('live-state', EMPTY_LIVE_STATE);
 * }
 * ```
 */
export function sharedState<T>(name: string, initial: T): WritableSignal<T> {
  const key = makeSharedStateKey<T>(name);
  const transferState = inject(TransferState);
  const state = signal<T>(transferState.get(key, initial));
  if (isPlatformServer(inject(PLATFORM_ID))) {
    effect(() => transferState.set(key, state()));
  }
  return state;
}
