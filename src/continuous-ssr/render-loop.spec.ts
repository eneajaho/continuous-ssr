import { RenderLoop, RouteRenderer } from './render-loop';
import { MemorySnapshotStore, Snapshot, etagFor } from './snapshot-store';

class FakeRenderer implements RouteRenderer {
  readonly calls: string[] = [];
  content = 'v1';
  private gate: Promise<void> = Promise.resolve();
  private release: (() => void) | undefined;

  /** Makes the next renders wait until `open()` is called. */
  hold(): void {
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  open(): void {
    this.release?.();
    this.release = undefined;
  }

  async render(url: string): Promise<string> {
    this.calls.push(url);
    await this.gate;
    return `<html>${url}:${this.content}</html>`;
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('RenderLoop', () => {
  let renderer: FakeRenderer;
  let store: MemorySnapshotStore;

  beforeEach(() => {
    renderer = new FakeRenderer();
    store = new MemorySnapshotStore();
  });

  it('renders every route into the store with a shared version', async () => {
    const loop = new RenderLoop({ renderer, store, routes: ['/', '/about'], now: () => 'T' });

    await loop.refresh();

    expect(renderer.calls).toEqual(['/', '/about']);
    expect(loop.currentVersion).toBe(1);
    expect(await store.get('/')).toEqual({
      path: '/',
      html: '<html>/:v1</html>',
      version: 1,
      renderedAt: 'T',
      etag: etagFor('<html>/:v1</html>'),
    });
    expect((await store.get('/about'))?.version).toBe(1);
    expect(loop.stats.lastRun).toMatchObject({ version: 1, routes: 2, failed: [], reasons: 'unspecified' });
  });

  it('bumps the version and replaces snapshots on the next refresh', async () => {
    const loop = new RenderLoop({ renderer, store, routes: ['/'] });
    await loop.refresh();
    const firstEtag = (await store.get('/'))?.etag;

    renderer.content = 'v2';
    await loop.refresh();

    expect(loop.currentVersion).toBe(2);
    expect((await store.get('/'))?.html).toBe('<html>/:v2</html>');
    expect((await store.get('/'))?.etag).not.toBe(firstEtag);
  });

  it('coalesces refreshes requested while a run is in progress into one follow-up run', async () => {
    const loop = new RenderLoop({ renderer, store, routes: ['/', '/about'] });
    renderer.hold();

    const first = loop.refresh('a');
    await flush();
    expect(loop.isRunning).toBe(true);
    expect(renderer.calls).toEqual(['/']);

    renderer.content = 'v2';
    const second = loop.refresh('b');
    const third = loop.refresh('c');
    expect(second).toBe(first);
    expect(third).toBe(first);

    renderer.open();
    await first;

    expect(renderer.calls).toEqual(['/', '/about', '/', '/about']);
    expect(loop.currentVersion).toBe(2);
    expect(loop.stats.lastRun?.reasons).toBe('b,c');
    expect(loop.isRunning).toBe(false);
    expect((await store.get('/about'))?.html).toBe('<html>/about:v2</html>');
  });

  it('renders only the named paths on a targeted refresh, and everything when a full one is queued too', async () => {
    const loop = new RenderLoop({ renderer, store, routes: ['/', '/about', '/news'] });
    await loop.refresh('warm-up');
    renderer.calls.length = 0;

    await loop.refresh('webhook', ['/news', '/nope']);
    expect(renderer.calls).toEqual(['/news']);

    renderer.hold();
    const run = loop.refresh('targeted', ['/about']);
    await flush();
    void loop.refresh('full');
    renderer.open();
    await run;

    expect(renderer.calls).toEqual(['/news', '/about', '/', '/about', '/news']);
  });

  it('resolves routes before each run, renders new ones and drops snapshots of removed ones', async () => {
    let routes = ['/', '/news/1'];
    const dropped: string[][] = [];
    const loop = new RenderLoop({
      renderer,
      store,
      routes: () => routes,
      onRoutesDropped: (paths) => dropped.push([...paths]),
    });
    await loop.refresh();

    routes = ['/', '/news/2'];
    renderer.calls.length = 0;
    await loop.refresh('targeted', ['/']);

    expect(renderer.calls).toEqual(['/', '/news/2']);
    expect(await store.get('/news/1')).toBeUndefined();
    expect(dropped).toEqual([['/news/1']]);
    expect(loop.routes).toEqual(['/', '/news/2']);
  });

  it('applies the post-processor and reports stored snapshots', async () => {
    const stored: Snapshot[] = [];
    const loop = new RenderLoop({
      renderer,
      store,
      routes: ['/'],
      postProcess: (html, path) => `${html}<!--${path}-->`,
      onSnapshotStored: (snapshot) => {
        stored.push(snapshot);
      },
    });

    await loop.refresh();

    expect((await store.get('/'))?.html).toBe('<html>/:v1</html><!--/-->');
    expect(stored.map((s) => s.path)).toEqual(['/']);
  });

  it('reports a failing route, keeps rendering the others and counts fully failed runs', async () => {
    const failures: string[] = [];
    const failing: RouteRenderer = {
      render: (url) =>
        url === '/broken' ? Promise.reject(new Error('boom')) : Promise.resolve(`<html>${url}</html>`),
    };
    const loop = new RenderLoop({
      renderer: failing,
      store,
      routes: ['/broken', '/ok'],
      onError: (_error, path) => failures.push(path),
    });

    await loop.refresh();

    expect(failures).toEqual(['/broken']);
    expect(await store.get('/broken')).toBeUndefined();
    expect((await store.get('/ok'))?.html).toBe('<html>/ok</html>');
    expect(loop.stats).toMatchObject({ consecutiveFailedRuns: 0, lastRun: { failed: ['/broken'] } });

    await loop.refresh('only-broken', ['/broken']);
    expect(loop.stats.consecutiveFailedRuns).toBe(1);
  });
});
