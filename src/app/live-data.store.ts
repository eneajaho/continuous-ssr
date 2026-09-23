import { HttpClient } from '@angular/common/http';
import { REQUEST, Service, computed, inject } from '@angular/core';
import { sharedState } from '../continuous-ssr';

/** The application state that the server keeps live and serializes into every snapshot. */
export interface LiveState {
  readonly counter: number;
  readonly message: string;
  /** ISO timestamp of the last change, produced by the server. */
  readonly updatedAt: string;
}

export const LIVE_STATE_NAME = 'live-state';

export const EMPTY_LIVE_STATE: LiveState = {
  counter: 0,
  message: 'Waiting for the first update',
  updatedAt: '',
};

/**
 * Holds the live state as signals. In the live application the server's data sources mutate
 * it; `sharedState` mirrors it into every snapshot and seeds it back during hydration.
 *
 * A per-request render (a signed-in visitor, a page without a snapshot) is a fresh application
 * with no live instance behind it, so it fetches the current state itself: the pattern any
 * service should follow for data it needs on bootstrap.
 */
@Service()
export class LiveDataStore {
  private readonly state = sharedState<LiveState>(LIVE_STATE_NAME, EMPTY_LIVE_STATE);

  constructor() {
    if (inject(REQUEST, { optional: true })) {
      inject(HttpClient)
        .get<{ state: LiveState | null }>('/api/state', { transferCache: false })
        .subscribe({ next: ({ state }) => state && this.state.set(state), error: () => undefined });
    }
  }

  readonly snapshot = this.state.asReadonly();
  readonly counter = computed(() => this.state().counter);
  readonly message = computed(() => this.state().message);
  readonly updatedAt = computed(() => this.state().updatedAt);

  apply(next: LiveState): void {
    this.state.set(next);
  }

  increment(updatedAt: string): void {
    this.state.update((current) => ({ ...current, counter: current.counter + 1, updatedAt }));
  }

  setMessage(message: string, updatedAt: string): void {
    this.state.update((current) => ({ ...current, message, updatedAt }));
  }
}
