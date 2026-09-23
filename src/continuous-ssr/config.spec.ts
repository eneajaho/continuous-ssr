import { Component, EnvironmentInjector, Service, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { discoverStaticRoutes, expandRoute, isExcluded, resolveSnapshotRoutes } from './config';

@Service()
class Catalog {
  readonly ids = signal(['1', '2']);
}

@Component({ template: '' })
class Page {}

describe('discoverStaticRoutes', () => {
  it('returns static component routes, nested ones included, and skips the rest', () => {
    const routes = discoverStaticRoutes([
      { path: '', component: Page },
      { path: 'news', loadComponent: () => Promise.resolve(Page) },
      { path: 'items/:id', component: Page },
      { path: 'legacy', redirectTo: 'news' },
      { path: 'lazy', loadChildren: () => Promise.resolve([]) },
      {
        path: 'docs',
        children: [
          { path: '', component: Page },
          { path: 'intro', component: Page },
          { path: ':slug', component: Page },
        ],
      },
      { path: '**', component: Page },
    ]);

    expect(routes).toEqual(['/', '/news', '/docs', '/docs/intro']);
  });
});

describe('expandRoute', () => {
  it('fills parameters and encodes values', () => {
    expect(expandRoute('news/:id', { id: '7' })).toBe('/news/7');
    expect(expandRoute('/shop/:category/:slug', { category: 'a b', slug: 'x' })).toBe('/shop/a%20b/x');
    expect(() => expandRoute('news/:id', {})).toThrow(/"id"/);
  });
});

describe('isExcluded', () => {
  it('matches exact strings and patterns', () => {
    expect(isExcluded('/account', ['/account'])).toBe(true);
    expect(isExcluded('/account/orders', ['/account'])).toBe(false);
    expect(isExcluded('/account/orders', [/^\/account/])).toBe(true);
    expect(isExcluded('/', [])).toBe(false);
  });
});

describe('resolveSnapshotRoutes', () => {
  it('combines discovered, explicit and parameterised routes and applies exclusions', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: Page },
          { path: 'account', component: Page },
          { path: 'items/:id', component: Page },
        ]),
      ],
    });
    const injector = TestBed.inject(EnvironmentInjector);

    const routes = await resolveSnapshotRoutes(injector, {
      routes: ['extra', { path: 'items/:id', params: () => inject(Catalog).ids().map((id) => ({ id })) }],
      exclude: ['/account'],
    });

    expect(routes).toEqual(['/', '/extra', '/items/1', '/items/2']);
  });

  it('can skip discovery', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '', component: Page }])] });

    expect(await resolveSnapshotRoutes(TestBed.inject(EnvironmentInjector), { discoverRoutes: false, routes: ['/only'] })).toEqual(['/only']);
  });
});
