import { ApplicationRef, Component, Service, computed, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouteDependencyTracker, collectViewProducers } from './route-dependencies';

@Service()
class Counter {
  readonly count = signal(0);
  readonly other = signal('unused');
  readonly doubled = computed(() => this.count() * 2);
}

@Component({ selector: 'app-reads', template: '<p>{{ counter.doubled() }}</p><b>{{ local() }}</b>' })
class ReadsSignals {
  protected readonly counter = inject(Counter);
  protected readonly local = signal('x');
}

@Component({ selector: 'app-static', template: '<p>static</p>' })
class ReadsNothing {}

describe('collectViewProducers', () => {
  it('finds the producers a rendered view depends on', async () => {
    const fixture = TestBed.createComponent(ReadsSignals);
    await fixture.whenStable();

    const producers = collectViewProducers([fixture.componentRef.hostView]);

    // doubled (a computed) and local; count is reached through doubled, not read directly.
    expect(producers?.size).toBe(2);
  });

  it('returns an empty set for views without reactive reads and undefined for foreign objects', async () => {
    const fixture = TestBed.createComponent(ReadsNothing);
    await fixture.whenStable();

    expect(collectViewProducers([fixture.componentRef.hostView])?.size).toBe(0);
    expect(collectViewProducers([{} as never])).toBeUndefined();
  });
});

describe('RouteDependencyTracker', () => {
  it('marks a route dirty when a producer it depends on changes, even through a computed', async () => {
    const fixture = TestBed.createComponent(ReadsSignals);
    await fixture.whenStable();
    const appRef = TestBed.inject(ApplicationRef);
    appRef.attachView(fixture.componentRef.hostView);
    const components = [fixture.componentRef];
    Object.defineProperty(appRef, 'components', { get: () => components });
    const dirty: (string | null)[] = [];
    let rendering = false;
    const tracker = new RouteDependencyTracker({
      appRef,
      isRendering: () => rendering,
      sharedSignals: () => [],
      onDirty: (r) => dirty.push(r),
    });

    expect(tracker.track('/reads')).toBe(2);

    // Changes caused by rendering are dropped, and the watch stays armed for real ones.
    rendering = true;
    TestBed.inject(Counter).count.set(-1);
    await Promise.resolve();
    rendering = false;
    expect(dirty).toEqual([]);
    TestBed.inject(Counter).other.set('still unused');
    expect(dirty).toEqual([]);

    TestBed.inject(Counter).count.set(1);
    expect(dirty).toEqual(['/reads']);
    expect(tracker.takeDirty()).toEqual(['/reads']);
    expect(tracker.takeDirty()).toEqual([]);
    tracker.destroy();
  });

  it('marks everything dirty when a shared signal changes', () => {
    const shared = signal('a');
    const appRef = TestBed.inject(ApplicationRef);
    const dirty: (string | null)[] = [];
    const tracker = new RouteDependencyTracker({
      appRef,
      isRendering: () => false,
      sharedSignals: () => [shared],
      onDirty: (r) => dirty.push(r),
    });
    tracker.track('/any');

    shared.set('b');

    expect(dirty).toEqual([null]);
    expect(tracker.takeDirty()).toBeNull();
    tracker.destroy();
  });
});
