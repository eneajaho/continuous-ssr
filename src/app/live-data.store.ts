import { Service, computed } from '@angular/core';
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
 * Holds the live state as signals. On the server the render loop's data sources mutate it;
 * `sharedState` mirrors it into every snapshot and seeds it back during hydration.
 */
@Service()
export class LiveDataStore {
  private readonly state = sharedState<LiveState>(LIVE_STATE_NAME, EMPTY_LIVE_STATE);

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
