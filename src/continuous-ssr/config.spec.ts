import { Component } from '@angular/core';
import { discoverStaticRoutes } from './config';

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
