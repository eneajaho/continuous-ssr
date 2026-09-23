import { ApplicationRef, Signal, ViewRef } from '@angular/core';
import {
  ReactiveNode,
  SIGNAL,
  Watch,
  createWatch,
  producerAccessed,
} from '@angular/core/primitives/signals';
import { Logger, NOOP_LOGGER } from './log';

/**
 * Angular's templates and host bindings are reactive consumers stored inside the view
 * arrays (`LView`); each one links to the producers (signals, computeds, resource values) it
 * read during its last render as a singly linked list. The shapes below are all that is
 * needed to find them (see `producerAccessed` in `@angular/core/primitives/signals`).
 */
interface ProducerLink {
  readonly producer: ReactiveNode;
  readonly nextProducer?: ProducerLink;
}

interface ConsumerLike {
  readonly producers?: ProducerLink;
  readonly consumerMarkedDirty: unknown;
}

function isConsumer(value: unknown): value is ConsumerLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ConsumerLike).consumerMarkedDirty === 'function' &&
    'producers' in value
  );
}

/**
 * Every producer the given views currently depend on. Views are walked as the nested arrays
 * Angular stores them in (`LView` and `LContainer`), collecting the producers of each reactive
 * consumer found along the way. Returns `undefined` when the views cannot be inspected, so the
 * caller can fall back to refreshing everything.
 */
export function collectViewProducers(views: readonly ViewRef[]): Set<ReactiveNode> | undefined {
  const producers = new Set<ReactiveNode>();
  const visited = new Set<unknown>();
  let roots = 0;

  const walk = (value: unknown): void => {
    if (!Array.isArray(value) || visited.has(value)) {
      return;
    }
    visited.add(value);
    for (const item of value) {
      if (Array.isArray(item)) {
        walk(item);
      } else if (isConsumer(item)) {
        for (let link = item.producers; link !== undefined; link = link.nextProducer) {
          // Inputs are set by the parent view or the router, not by application state.
          if ((link.producer as { kind?: string }).kind !== 'input') {
            producers.add(link.producer);
          }
        }
      }
    }
  };

  for (const view of views) {
    const lView: unknown = (view as unknown as { _lView?: unknown })._lView;
    if (Array.isArray(lView)) {
      roots++;
      walk(lView);
    }
  }
  return roots === views.length ? producers : undefined;
}

export interface RouteDependencyTrackerOptions {
  readonly appRef: ApplicationRef;
  /**
   * Whether the renderer is navigating or serializing right now. Producers that change then
   * (router signals, inputs, resources loading) are consequences of rendering, not application
   * changes; marks made while it is true are dropped and the watch re-armed.
   */
  readonly isRendering: () => boolean;
  /** Signals whose change means every snapshot changed, such as `sharedState` ones. */
  readonly sharedSignals: () => readonly Signal<unknown>[];
  /** Called synchronously when a tracked producer changes. */
  readonly onDirty: (route: string | null) => void;
  readonly log?: Logger;
}

/**
 * Knows which reactive producers each snapshot route depends on, and which routes a change
 * made stale.
 *
 * After a route renders, `track(route)` snapshots the producers its mounted views read and
 * keeps one live watch over them. A later write to any of those producers marks the route
 * dirty at write time, even if no view reads it any more because another route is active.
 * Shared signals are watched separately and mark every route.
 */
export class RouteDependencyTracker {
  private readonly watches = new Map<string, Watch>();
  private readonly producerCounts = new Map<string, number>();
  private readonly dirty = new Set<string>();
  private globalDirty = false;
  private sharedWatch: Watch | undefined;
  private unsupported = false;
  private readonly log: Logger;

  constructor(private readonly options: RouteDependencyTrackerOptions) {
    this.log = options.log ?? NOOP_LOGGER;
  }

  /** Whether views could be inspected so far; once false, callers should refresh everything. */
  get supported(): boolean {
    return !this.unsupported;
  }

  /** Record the dependencies of `route` right after it rendered, while its views are mounted. */
  track(route: string): number {
    this.untrack(route);
    this.dirty.delete(route);
    this.watchSharedSignals();

    const producers = collectViewProducers(this.options.appRef.components.map((c) => c.hostView));
    if (!producers) {
      if (!this.unsupported) {
        this.unsupported = true;
        this.log.warn('views cannot be inspected; every change refreshes every route');
      }
      return 0;
    }

    if (producers.size > 0) {
      const watch = this.createWatch(producers, () => {
        this.dirty.add(route);
        this.options.onDirty(route);
      });
      this.watches.set(route, watch);
    }
    this.producerCounts.set(route, producers.size);
    return producers.size;
  }

  untrack(route: string): void {
    this.watches.get(route)?.destroy();
    this.watches.delete(route);
    this.producerCounts.delete(route);
  }

  /** Routes marked dirty since the last call, or `null` when everything is (shared change). */
  takeDirty(): string[] | null {
    if (this.globalDirty) {
      this.globalDirty = false;
      this.dirty.clear();
      return null;
    }
    const routes = Array.from(this.dirty);
    this.dirty.clear();
    return routes;
  }

  producersOf(route: string): number {
    return this.producerCounts.get(route) ?? 0;
  }

  destroy(): void {
    for (const watch of this.watches.values()) {
      watch.destroy();
    }
    this.watches.clear();
    this.sharedWatch?.destroy();
    this.sharedWatch = undefined;
  }

  private watchSharedSignals(): void {
    const nodes = this.options
      .sharedSignals()
      .map((signal) => (signal as unknown as { [SIGNAL]?: ReactiveNode })[SIGNAL])
      .filter((node): node is ReactiveNode => node !== undefined);
    this.sharedWatch?.destroy();
    this.sharedWatch = this.createWatch(new Set(nodes), () => {
      this.globalDirty = true;
      this.options.onDirty(null);
    });
  }

  /**
   * A live watch over `producers` that calls `onChange` when any of them changes outside
   * rendering. A watch stops notifying once dirty, so after a dropped notification it is run
   * again (asynchronously, as running inside the notification is not allowed) to re-arm it.
   */
  private createWatch(producers: ReadonlySet<ReactiveNode>, onChange: () => void): Watch {
    let destroyed = false;
    const watch = createWatch(
      () => producers.forEach((producer) => producerAccessed(producer)),
      () => {
        if (this.options.isRendering()) {
          queueMicrotask(() => {
            if (!destroyed) {
              watch.run();
            }
          });
          return;
        }
        onChange();
      },
      false,
    );
    watch.run();
    const destroy = watch.destroy;
    return {
      ...watch,
      destroy: () => {
        destroyed = true;
        destroy();
      },
    };
  }
}
