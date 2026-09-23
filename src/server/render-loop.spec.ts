import { RenderLoop, RouteRenderer } from './render-loop';
import { SnapshotStore, etagFor } from './snapshot-store';

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
  let store: SnapshotStore;

  beforeEach(() => {
    renderer = new FakeRenderer();
    store = new SnapshotStore();
  });

  it('renders every route into the store with a shared version', async () => {
    const loop = new RenderLoop({ renderer, store, routes: ['/', '/about'], now: () => 'T' });

    await loop.refresh();

    expect(renderer.calls).toEqual(['/', '/about']);
    expect(loop.currentVersion).toBe(1);
    expect(store.get('/')).toEqual({
      path: '/',
      html: '<html>/:v1</html>',
      version: 1,
      renderedAt: 'T',
      etag: etagFor('<html>/:v1</html>'),
    });
    expect(store.get('/about')?.version).toBe(1);
  });

  it('bumps the version and replaces snapshots on the next refresh', async () => {
    const loop = new RenderLoop({ renderer, store, routes: ['/'] });
    await loop.refresh();
    const firstEtag = store.get('/')?.etag;

    renderer.content = 'v2';
    await loop.refresh();

    expect(loop.currentVersion).toBe(2);
    expect(store.get('/')?.html).toBe('<html>/:v2</html>');
    expect(store.get('/')?.etag).not.toBe(firstEtag);
  });

  it('coalesces refreshes requested while a run is in progress into one follow-up run', async () => {
    const loop = new RenderLoop({ renderer, store, routes: ['/', '/about'] });
    renderer.hold();

    const first = loop.refresh();
    await flush();
    expect(loop.isRunning).toBe(true);
    expect(renderer.calls).toEqual(['/']);

    renderer.content = 'v2';
    const second = loop.refresh();
    const third = loop.refresh();
    expect(second).toBe(first);
    expect(third).toBe(first);

    renderer.open();
    await first;

    expect(renderer.calls).toEqual(['/', '/about', '/', '/about']);
    expect(loop.currentVersion).toBe(2);
    expect(loop.isRunning).toBe(false);
    expect(store.get('/about')?.html).toBe('<html>/about:v2</html>');
  });

  it('applies the post-processor to every rendered document', async () => {
    const loop = new RenderLoop({
      renderer,
      store,
      routes: ['/'],
      postProcess: (html, path) => `${html}<!--${path}-->`,
    });

    await loop.refresh();

    expect(store.get('/')?.html).toBe('<html>/:v1</html><!--/-->');
  });

  it('reports a failing route and keeps rendering the others', async () => {
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
    expect(store.get('/broken')).toBeUndefined();
    expect(store.get('/ok')?.html).toBe('<html>/ok</html>');
    expect(loop.currentVersion).toBe(1);
  });
});

describe('etagFor', () => {
  it('is stable for equal input and different for different input', () => {
    expect(etagFor('abc')).toBe(etagFor('abc'));
    expect(etagFor('abc')).not.toBe(etagFor('abd'));
    expect(etagFor('abc')).toMatch(/^"[0-9a-f]{8}-[0-9a-f]+"$/);
  });
});
