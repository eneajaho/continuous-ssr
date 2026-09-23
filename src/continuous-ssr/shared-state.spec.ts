import { ApplicationRef, PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { makeSharedStateKey, registeredSharedStateKeys, sharedState } from './shared-state';

describe('makeSharedStateKey', () => {
  it('creates a state key and registers its name once', () => {
    const key = makeSharedStateKey<number>('spec-shared');
    makeSharedStateKey<number>('spec-shared');

    expect(key).toBe('spec-shared');
    expect(registeredSharedStateKeys().filter((name) => name === 'spec-shared')).toHaveLength(1);
  });
});

describe('sharedState', () => {
  it('starts from the initial value and registers the key', () => {
    const state = TestBed.runInInjectionContext(() => sharedState('spec-initial', { n: 1 }));

    expect(state()).toEqual({ n: 1 });
    expect(registeredSharedStateKeys()).toContain('spec-initial');
  });

  it('starts from transferred state in the browser', () => {
    TestBed.inject(TransferState).set(makeStateKey<string>('spec-transferred'), 'from the server');

    const state = TestBed.runInInjectionContext(() => sharedState('spec-transferred', 'initial'));

    expect(state()).toBe('from the server');
  });

  it('mirrors writes into TransferState on the server', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
    const transferState = TestBed.inject(TransferState);
    const state = TestBed.runInInjectionContext(() => sharedState('spec-mirrored', 'a'));

    state.set('b');
    await TestBed.inject(ApplicationRef).whenStable();

    expect(transferState.get(makeStateKey<string>('spec-mirrored'), '')).toBe('b');
  });
});
