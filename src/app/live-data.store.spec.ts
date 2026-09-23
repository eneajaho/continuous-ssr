import { TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EMPTY_LIVE_STATE, LIVE_STATE_NAME, LiveDataStore, LiveState } from './live-data.store';

describe('LiveDataStore', () => {
  it('starts from the empty state when nothing was transferred', () => {
    const store = TestBed.inject(LiveDataStore);

    expect(store.snapshot()).toEqual(EMPTY_LIVE_STATE);
  });

  it('seeds itself from transferred state', () => {
    TestBed.inject(TransferState).set(makeStateKey<LiveState>(LIVE_STATE_NAME), {
      counter: 7,
      message: 'from the server',
      updatedAt: '2026-09-23T10:00:00.000Z',
    });

    const store = TestBed.inject(LiveDataStore);

    expect(store.counter()).toBe(7);
    expect(store.message()).toBe('from the server');
    expect(store.updatedAt()).toBe('2026-09-23T10:00:00.000Z');
  });

  it('increments and updates the message while keeping the rest', () => {
    const store = TestBed.inject(LiveDataStore);

    store.increment('T1');
    store.increment('T2');
    store.setMessage('hi', 'T3');

    expect(store.snapshot()).toEqual({ counter: 2, message: 'hi', updatedAt: 'T3' });
  });
});
