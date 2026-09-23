import { Component, Service, destroyPlatform, inject, input, signal } from '@angular/core';
import { BootstrapContext, bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { provideServerRendering } from '@angular/platform-server';
import { RouterOutlet, provideRouter, withComponentInputBinding } from '@angular/router';
import { provideContinuousRendering } from './config';
import { ContinuousAppEngine } from './engine';
import { sharedState } from './shared-state';
import { MemorySnapshotStore } from './snapshot-store';

@Service()
class Feed {
  readonly headline = sharedState('headline', 'first');
  /** Read by the about page only: a plain signal, tracked through the view's dependencies. */
  readonly footnote = signal('note 1');
  /** Read by nobody's template: changing it must not trigger a re-render by itself. */
  readonly itemIds = signal(['1', '2']);
}

@Component({ selector: 'app-item', template: '<h1>Item {{ id() }}</h1>' })
class ItemPage {
  readonly id = input.required<string>();
}

@Component({ selector: 'app-home', template: '<h1>{{ feed.headline() }}</h1>' })
class HomePage {
  protected readonly feed = inject(Feed);
}

@Component({ selector: 'app-about', template: '<h1>About</h1><p>{{ feed.footnote() }}</p>' })
class AboutPage {
  protected readonly feed = inject(Feed);
}

@Component({ selector: 'app-root', imports: [RouterOutlet], template: '<router-outlet />' })
class TestApp {}

const DOCUMENT_TEMPLATE =
  '<!doctype html><html><head><title>test</title></head><body><app-root></app-root></body></html>';

const bootstrap = (context: BootstrapContext) =>
  bootstrapApplication(
    TestApp,
    {
      providers: [
        provideServerRendering(),
        provideClientHydration(),
        provideRouter(
          [
            { path: '', component: HomePage },
            { path: 'about', component: AboutPage },
            { path: 'items/:id', component: ItemPage },
            { path: 'secret', component: AboutPage },
          ],
          withComponentInputBinding(),
        ),
        provideContinuousRendering({
          debounceMs: 10,
          exclude: ['/secret'],
          routes: [{ path: 'items/:id', params: () => inject(Feed).itemIds().map((id) => ({ id })) }],
        }),
      ],
    },
    context,
  );

async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('ContinuousAppEngine', () => {
  let engine: ContinuousAppEngine;
  const prepared: string[] = [];

  beforeAll(async () => {
    destroyPlatform();
    engine = await ContinuousAppEngine.start({
      bootstrap,
      document: DOCUMENT_TEMPLATE,
      origin: 'http://localhost',
      prepare: (injector) => {
        prepared.push(injector.get(Feed).headline());
      },
    });
  });

  afterAll(() => {
    engine.stop();
  });


  it('discovers static routes, expands parameterised ones and honours exclusions', async () => {
    expect((await engine.snapshots()).map((snapshot) => snapshot.path).sort()).toEqual([
      '/',
      '/about',
      '/items/1',
      '/items/2',
    ]);
    expect(engine.version).toBe(1);
    expect(await (await engine.handle(new Request('http://localhost/items/2')))!.text()).toContain('<h1>Item 2</h1>');
  });

  it('re-expands parameters before each run, adding and dropping instances', async () => {
    engine.injector.get(Feed).itemIds.set(['2', '3']);

    await engine.refresh('params changed', ['/about']);

    expect((await engine.snapshots()).map((snapshot) => snapshot.path).sort()).toEqual([
      '/',
      '/about',
      '/items/2',
      '/items/3',
    ]);
    expect(await (await engine.handle(new Request('http://localhost/items/3')))!.text()).toContain('<h1>Item 3</h1>');
    engine.injector.get(Feed).itemIds.set(['1', '2']);
    await engine.refresh('restore');
  });

  it('answers requests for snapshot paths with hydration-ready HTML and cache headers', async () => {
    const response = await engine.handle(new Request('http://localhost/'));

    expect(response?.status).toBe(200);
    expect(response?.headers.get('x-ssr-mode')).toBe('continuous');
    expect(response?.headers.get('etag')).toBeTruthy();
    const html = await response!.text();
    expect(html).toContain('<h1>first</h1>');
    expect(html).toMatch(/ngh="\d+"/);
  });

  it('answers conditional requests with 304 and ignores non-snapshot paths and methods', async () => {
    const etag = (await engine.handle(new Request('http://localhost/about')))!.headers.get('etag')!;

    expect((await engine.handle(new Request('http://localhost/about', { headers: { 'if-none-match': etag } })))?.status).toBe(304);
    expect(await engine.handle(new Request('http://localhost/items/9'))).toBeNull();
    expect(await engine.handle(new Request('http://localhost/', { method: 'POST' }))).toBeNull();
  });

  it('re-renders on its own when shared state changes, whichever route is active', async () => {
    const before = engine.version;
    // The last route rendered was /about, so nothing mounted reads the headline.

    engine.injector.get(Feed).headline.set('second');
    await until(() => engine.version > before);

    const html = await (await engine.handle(new Request('http://localhost/')))!.text();
    expect(html).toContain('<h1>second</h1>');
    expect(html).toContain('"headline":"second"');
    const health = await engine.health();
    expect(health.lastRun?.reasons).toContain('shared-state');
    expect(health.lastRun?.routes).toBe(4);
  });

  it('re-renders only the routes that depend on a changed signal, whichever route is active', async () => {
    const before = engine.version;
    const homeBefore = (await engine.snapshots()).find((s) => s.path === '/')!.version;

    engine.injector.get(Feed).footnote.set('note 2');
    await until(() => engine.version > before);

    const health = await engine.health();
    expect(health.lastRun?.routes).toBe(1);
    expect(health.lastRun?.reasons).toContain('dependency:/about');
    expect(await (await engine.handle(new Request('http://localhost/about')))!.text()).toContain('<p>note 2</p>');
    expect((await engine.snapshots()).find((s) => s.path === '/')!.version).toBe(homeBefore);
  });

  it('reports health with instance, run and snapshot details', async () => {
    const health = await engine.health();

    expect(health.ok).toBe(true);
    expect(health.role).toBe('render');
    expect(health.instance).toMatchObject({ renders: expect.any(Number), recycles: 0, recycling: false });
    expect(health.lastRun?.failed).toEqual([]);
    expect(health.snapshots.map((s) => s.path).sort()).toEqual(['/', '/about', '/items/1', '/items/2']);
    expect(prepared).toEqual(['first']);
  });

  it('recycles into a fresh application while keeping snapshots and auto-refresh', async () => {
    const oldInjector = engine.injector;
    engine.injector.get(Feed).headline.set('before recycle');
    await until(() => (engine.version > 0) && !(engine.injector.get(Feed).headline() !== 'before recycle'));

    await engine.recycle('spec');

    expect(engine.injector).not.toBe(oldInjector);
    expect((await engine.health()).instance?.recycles).toBe(1);
    expect(prepared).toEqual(['first', 'first']);
    // The fresh instance starts from its own initial state and rendered it.
    const html = await (await engine.handle(new Request('http://localhost/')))!.text();
    expect(html).toContain('<h1>first</h1>');

    const before = engine.version;
    engine.injector.get(Feed).headline.set('after recycle');
    await until(() => engine.version > before);
    expect(await (await engine.handle(new Request('http://localhost/')))!.text()).toContain('<h1>after recycle</h1>');
  });

  it('shares its store with a serve-only engine and notifies stored snapshots', async () => {
    const stored: string[] = [];
    const store = new MemorySnapshotStore();
    engine.stop();
    const renderer = await ContinuousAppEngine.start({
      bootstrap,
      document: DOCUMENT_TEMPLATE,
      origin: 'http://localhost',
      store,
      onSnapshotStored: (snapshot) => {
        stored.push(snapshot.path);
      },
    });
    const server = await ContinuousAppEngine.start({
      bootstrap,
      document: DOCUMENT_TEMPLATE,
      origin: 'http://localhost',
      role: 'serve',
      store,
    });

    try {
      expect(stored.sort()).toEqual(['/', '/about', '/items/1', '/items/2']);
      expect(server.role).toBe('serve');
      expect((await server.handle(new Request('http://localhost/about')))?.status).toBe(200);
      expect(() => server.injector).toThrow();
      await expect(server.refresh()).rejects.toThrow();
    } finally {
      server.stop();
      renderer.stop();
    }
  });
});
