import { isPlatformServer } from '@angular/common';
import {
  PLATFORM_ID,
  Service,
  TransferState,
  computed,
  effect,
  inject,
  makeStateKey,
  signal,
} from '@angular/core';

/** The application state that the server keeps live and serializes into every snapshot. */
export interface LiveState {
  readonly counter: number;
  readonly message: string;
  /** ISO timestamp of the last change, produced by the server. */
  readonly updatedAt: string;
}

export const LIVE_STATE_KEY = makeStateKey<LiveState>('live-state');

export const EMPTY_LIVE_STATE: LiveState = {
  counter: 0,
  message: 'Waiting for the first update',
  updatedAt: '',
};

/**
 * Holds the live state as signals.
 *
 * On the server the store lives inside the long-running application and is mutated by the
 * render loop; an effect mirrors every change into `TransferState` so the serialized snapshot
 * carries it. In the browser the store seeds itself from that transferred state during hydration.
 */
@Service()
export class LiveDataStore {
  private readonly transferState = inject(TransferState);
  private readonly state = signal<LiveState>(
    this.transferState.get(LIVE_STATE_KEY, EMPTY_LIVE_STATE),
  );

  readonly snapshot = this.state.asReadonly();
  readonly counter = computed(() => this.state().counter);
  readonly message = computed(() => this.state().message);
  readonly updatedAt = computed(() => this.state().updatedAt);

  constructor() {
    if (isPlatformServer(inject(PLATFORM_ID))) {
      effect(() => this.transferState.set(LIVE_STATE_KEY, this.state()));
    }
  }

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
