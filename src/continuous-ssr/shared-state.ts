import { isPlatformServer } from '@angular/common';
import {
  PLATFORM_ID,
  Signal,
  StateKey,
  TransferState,
  WritableSignal,
  computed,
  effect,
  inject,
  makeStateKey,
  signal,
} from '@angular/core';

const registry = new Set<string>();
const signals = new Set<Signal<unknown>>();

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

/** Every signal created with `sharedState`; a change to any of them touches every snapshot. */
export function registeredSharedSignals(): readonly Signal<unknown>[] {
  return Array.from(signals);
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
    signals.add(state);
    effect(() => transferState.set(key, state()));
  }
  return state;
}

/**
 * Route-local server state that hydrates. Call it inside a page component.
 *
 * On the server it is `computed(source)`, mirrored into `TransferState` under `name` while
 * the page renders, so the key belongs to this route's snapshot only and a change to whatever
 * `source` reads re-renders just this route. In the browser it is the transferred value; when
 * none was transferred (client-side navigation to a page that was not in the snapshot),
 * `source` runs in the browser instead.
 *
 * ```ts
 * protected readonly banner = transferredState('about-banner', () => inject(Announcements).banner());
 * ```
 */
export function transferredState<T>(name: string, source: () => T): Signal<T> {
  const key = makeStateKey<T>(name);
  const transferState = inject(TransferState);
  const value = computed(source);
  if (isPlatformServer(inject(PLATFORM_ID))) {
    effect(() => transferState.set(key, value()));
    return value;
  }
  return transferState.hasKey(key) ? signal(transferState.get(key, value())).asReadonly() : value;
}
