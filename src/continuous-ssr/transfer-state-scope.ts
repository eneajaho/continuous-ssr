import { TransferState } from '@angular/core';

export type TransferStateStore = Record<string, unknown>;

/** Angular writes its hydration keys (`__nghData__`, `__nghDeferData__`) during every serialization. */
const ANGULAR_INTERNAL_PREFIX = '__ngh';

/**
 * Exposes the raw key/value store behind a `TransferState`.
 * `store` is a public field of the runtime class that the published typings leave out.
 */
export function storeOf(state: TransferState): TransferStateStore {
  return (state as unknown as { store: TransferStateStore }).store;
}

/**
 * Keeps `TransferState` per route in a long-lived application.
 *
 * `TransferState` is one store for the whole app. Left alone, every key a route writes stays
 * there forever: other routes' snapshots would carry it, and on the server the HTTP transfer
 * cache would answer from it instead of fetching again. This scope attributes keys to the
 * route that wrote them, evicts a route's own keys before it is re-rendered so it fetches
 * fresh data, and withholds other routes' keys while a snapshot is serialized.
 *
 * Keys named in `sharedKeys` belong to every snapshot; so do Angular's internal ones.
 */
export class TransferStateScope {
  private readonly owners = new Map<string, Set<string>>();
  private readonly shared: ReadonlySet<string>;

  constructor(sharedKeys: readonly string[] = []) {
    this.shared = new Set(sharedKeys);
  }

  isShared(key: string): boolean {
    return this.shared.has(key) || key.startsWith(ANGULAR_INTERNAL_PREFIX);
  }

  ownersOf(key: string): readonly string[] {
    return Array.from(this.owners.get(key) ?? []);
  }

  /** Removes the keys `route` owns (shared ones excluded) so that a fresh navigation re-fetches them. */
  evict(store: TransferStateStore, route: string): string[] {
    const evicted: string[] = [];
    for (const key of Object.keys(store)) {
      if (!this.isShared(key) && this.owners.get(key)?.has(route)) {
        delete store[key];
        evicted.push(key);
      }
    }
    return evicted;
  }

  /**
   * Drops everything known about `route`: its ownership records, and the keys nobody else
   * owns are removed from the store. For routes that stopped being snapshotted.
   */
  forget(store: TransferStateStore, route: string): string[] {
    const removed: string[] = [];
    for (const [key, owners] of this.owners) {
      if (!owners.delete(route)) {
        continue;
      }
      if (owners.size === 0) {
        this.owners.delete(key);
        if (!this.isShared(key) && Object.hasOwn(store, key)) {
          delete store[key];
          removed.push(key);
        }
      }
    }
    return removed;
  }

  /** A shallow copy of the store, to diff against after the route has rendered. */
  capture(store: TransferStateStore): TransferStateStore {
    return { ...store };
  }

  /** Attributes every key that is new or changed since `before` to `route`. */
  attribute(store: TransferStateStore, before: TransferStateStore, route: string): string[] {
    const written: string[] = [];
    for (const [key, value] of Object.entries(store)) {
      if (!Object.hasOwn(before, key) || before[key] !== value) {
        let owners = this.owners.get(key);
        if (!owners) {
          owners = new Set();
          this.owners.set(key, owners);
        }
        owners.add(route);
        written.push(key);
      }
    }
    return written;
  }

  /**
   * Takes every key known to belong to other routes out of the store. Keys nobody has written
   * during a render (app-wide state written between renders) are kept, like shared ones.
   */
  withhold(store: TransferStateStore, route: string): TransferStateStore {
    const withheld: TransferStateStore = {};
    for (const [key, value] of Object.entries(store)) {
      const owners = this.owners.get(key);
      if (!this.isShared(key) && owners && !owners.has(route)) {
        withheld[key] = value;
        delete store[key];
      }
    }
    return withheld;
  }

  /** Puts withheld keys back without overwriting anything written in the meantime. */
  restore(store: TransferStateStore, withheld: TransferStateStore): void {
    for (const [key, value] of Object.entries(withheld)) {
      if (!Object.hasOwn(store, key)) {
        store[key] = value;
      }
    }
  }
}
