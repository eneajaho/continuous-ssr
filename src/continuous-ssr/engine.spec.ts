import { Component, Service, destroyPlatform, inject } from '@angular/core';
import { BootstrapContext, bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { provideServerRendering } from '@angular/platform-server';
import { RouterOutlet, provideRouter } from '@angular/router';
import { provideContinuousRendering } from './config';
import { ContinuousAppEngine } from './engine';
import { sharedState } from './shared-state';

@Service()
class Feed {
  readonly headline = sharedState('headline', 'first');
}

@Component({ selector: 'app-home', template: '<h1>{{ feed.headline() }}</h1>' })
class HomePage {
  protected readonly feed = inject(Feed);
}

@Component({ selector: 'app-about', template: '<h1>About</h1>' })
class AboutPage {}

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
        provideRouter([
          { path: '', component: HomePage },
          { path: 'about', component: AboutPage },
          { path: 'items/:id', component: AboutPage },
        ]),
        provideContinuousRendering({ debounceMs: 10 }),
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

  beforeAll(async () => {
    destroyPlatform();
    engine = await ContinuousAppEngine.start({
      bootstrap,
      document: DOCUMENT_TEMPLATE,
      origin: 'http://localhost',
    });
  });

  afterAll(() => {
    engine.stop();
  });

  it('discovers static routes from the router config and warms them up', () => {
    expect(engine.snapshots.map((snapshot) => snapshot.path).sort()).toEqual(['/', '/about']);
    expect(engine.version).toBe(1);
  });

  it('answers requests for snapshot paths with hydration-ready HTML and cache headers', async () => {
    const response = engine.handle(new Request('http://localhost/'));

    expect(response?.status).toBe(200);
    expect(response?.headers.get('x-ssr-mode')).toBe('continuous');
    expect(response?.headers.get('etag')).toBeTruthy();
    const html = await response!.text();
    expect(html).toContain('<h1>first</h1>');
    expect(html).toMatch(/ngh="\d+"/);
  });

  it('answers conditional requests with 304 and ignores non-snapshot paths and methods', () => {
    const etag = engine.handle(new Request('http://localhost/about'))!.headers.get('etag')!;

    expect(engine.handle(new Request('http://localhost/about', { headers: { 'if-none-match': etag } }))?.status).toBe(304);
    expect(engine.handle(new Request('http://localhost/items/1'))).toBeNull();
    expect(engine.handle(new Request('http://localhost/', { method: 'POST' }))).toBeNull();
  });

  it('re-renders on its own when shared state changes, whichever route is active', async () => {
    const before = engine.version;
    // The last route rendered was /about, so nothing mounted reads the headline.

    engine.injector.get(Feed).headline.set('second');
    await until(() => engine.version > before);

    const html = await engine.handle(new Request('http://localhost/'))!.text();
    expect(html).toContain('<h1>second</h1>');
    expect(html).toContain('"headline":"second"');
  });
});
