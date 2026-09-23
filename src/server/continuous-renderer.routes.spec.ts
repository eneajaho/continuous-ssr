import { Component, TransferState, destroyPlatform, inject, makeStateKey } from '@angular/core';
import { BootstrapContext, bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { provideServerRendering } from '@angular/platform-server';
import { RouterOutlet, provideRouter } from '@angular/router';
import { ContinuousRenderer } from './continuous-renderer';

const A_KEY = makeStateKey<string>('a-data');
const B_KEY = makeStateKey<string>('b-data');
const SHARED_KEY = makeStateKey<string>('shared');
let fetches = 0;

@Component({ selector: 'app-a', template: '<h1>A</h1>' })
class PageA {
  constructor() {
    // Stands in for an HTTP call whose response lands in the transfer cache.
    inject(TransferState).set(A_KEY, `a-fetch-${++fetches}`);
  }
}

@Component({ selector: 'app-b', template: '<h1>B</h1>' })
class PageB {
  constructor() {
    inject(TransferState).set(B_KEY, 'b-fetch');
  }
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
        provideRouter([
          { path: 'a', component: PageA },
          { path: 'b', component: PageB },
        ]),
      ],
    },
    context,
  );

function transferState(html: string): Record<string, unknown> {
  const match = /<script id="ng-state" type="application\/json">(.*?)<\/script>/s.exec(html);
  if (!match) {
    throw new Error('no transfer state script in output');
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe('ContinuousRenderer transfer state scoping', () => {
  let renderer: ContinuousRenderer;

  beforeAll(async () => {
    destroyPlatform();
    renderer = await ContinuousRenderer.create({
      bootstrap,
      document: DOCUMENT_TEMPLATE,
      url: 'http://localhost/a',
      sharedStateKeys: [SHARED_KEY],
    });
    renderer.injector.get(TransferState).set(SHARED_KEY, 'everywhere');
  });

  afterAll(() => {
    renderer.destroy();
  });

  it('serializes only the keys the current route wrote plus shared ones', async () => {
    const stateA = transferState(await renderer.render('/a'));
    expect(stateA['a-data']).toBe('a-fetch-1');
    expect(stateA['shared']).toBe('everywhere');
    expect(stateA['b-data']).toBeUndefined();

    const stateB = transferState(await renderer.render('/b'));
    expect(stateB['b-data']).toBe('b-fetch');
    expect(stateB['shared']).toBe('everywhere');
    expect(stateB['a-data']).toBeUndefined();
    expect(stateB['__nghData__']).toBeDefined();
  });

  it('keeps withheld keys in the live store between renders', () => {
    const state = renderer.injector.get(TransferState);
    expect(state.hasKey(A_KEY)).toBe(true);
    expect(state.hasKey(B_KEY)).toBe(true);
  });

  it('evicts a route\'s own keys before re-rendering it so data is fetched again', async () => {
    const stateA = transferState(await renderer.render('/a'));

    expect(stateA['a-data']).toBe('a-fetch-2');
    expect(stateA['b-data']).toBeUndefined();
  });
});
