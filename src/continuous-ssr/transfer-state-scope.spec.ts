import { TransferState, makeStateKey } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TransferStateScope, storeOf } from './transfer-state-scope';

describe('TransferStateScope', () => {
  let scope: TransferStateScope;

  beforeEach(() => {
    scope = new TransferStateScope(['live-state']);
  });

  it('treats configured keys and Angular hydration keys as shared', () => {
    expect(scope.isShared('live-state')).toBe(true);
    expect(scope.isShared('__nghData__')).toBe(true);
    expect(scope.isShared('__nghDeferData__')).toBe(true);
    expect(scope.isShared('123456')).toBe(false);
  });

  it('attributes new and changed keys to the route that rendered them', () => {
    const store: Record<string, unknown> = { existing: 'same', changed: 'old' };
    const before = scope.capture(store);
    store['fresh'] = 1;
    store['changed'] = 'new';

    const written = scope.attribute(store, before, '/a');

    expect(written.sort()).toEqual(['changed', 'fresh']);
    expect(scope.ownersOf('fresh')).toEqual(['/a']);
    expect(scope.ownersOf('existing')).toEqual([]);
  });

  it('lets a key belong to several routes', () => {
    const store: Record<string, unknown> = {};
    store['api'] = { v: 1 };
    scope.attribute(store, {}, '/a');
    store['api'] = { v: 2 };
    scope.attribute(store, { api: { v: 1 } }, '/b');

    expect([...scope.ownersOf('api')].sort()).toEqual(['/a', '/b']);
  });

  it('withholds other routes keys during serialization and restores them afterwards', () => {
    const store: Record<string, unknown> = {};
    store['a-data'] = 'A';
    scope.attribute(store, {}, '/a');
    store['b-data'] = 'B';
    scope.attribute(store, { 'a-data': 'A' }, '/b');
    store['live-state'] = { counter: 1 };
    store['__nghData__'] = [];

    const withheld = scope.withhold(store, '/b');

    expect(Object.keys(store).sort()).toEqual(['__nghData__', 'b-data', 'live-state']);
    expect(withheld).toEqual({ 'a-data': 'A' });

    store['__nghData__'] = ['rewritten during serialization'];
    scope.restore(store, withheld);

    expect(store['a-data']).toBe('A');
    expect(store['__nghData__']).toEqual(['rewritten during serialization']);
  });

  it('keeps keys that no route has written, such as state written between renders', () => {
    const store: Record<string, unknown> = { 'a-data': 'A', 'between-renders': 'kept' };
    scope.attribute(store, { 'between-renders': 'kept' }, '/a');

    const withheld = scope.withhold(store, '/b');

    expect(withheld).toEqual({ 'a-data': 'A' });
    expect(store['between-renders']).toBe('kept');
  });

  it('evicts only the keys the route owns, keeping shared keys', () => {
    const store: Record<string, unknown> = {};
    store['a-data'] = 'A';
    store['live-state'] = 1;
    scope.attribute(store, {}, '/a');
    store['b-data'] = 'B';
    scope.attribute(store, { 'a-data': 'A', 'live-state': 1 }, '/b');

    const evicted = scope.evict(store, '/a');

    expect(evicted).toEqual(['a-data']);
    expect(Object.keys(store).sort()).toEqual(['b-data', 'live-state']);
  });

  it('forgets a route, removing keys only it owned', () => {
    const store: Record<string, unknown> = { 'a-only': 1, both: 2, 'b-only': 3 };
    scope.attribute(store, {}, '/a');
    scope.attribute(store, { 'a-only': 1, both: 1 }, '/b');
    store['both'] = 2;

    const removed = scope.forget(store, '/a');

    expect(removed).toEqual(['a-only']);
    expect(Object.keys(store).sort()).toEqual(['b-only', 'both']);
    expect(scope.ownersOf('both')).toEqual(['/b']);
    expect(scope.ownersOf('a-only')).toEqual([]);
  });

  it('reads the raw store of a real TransferState', () => {
    const state = TestBed.inject(TransferState);
    state.set(makeStateKey<string>('k'), 'v');

    expect(storeOf(state)).toEqual({ k: 'v' });
  });
});
