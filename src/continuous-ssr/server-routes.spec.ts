import { EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RenderMode, ServerRoute, provideServerRendering, withRoutes } from '@angular/ssr';
import { findServerRoutesToken, isServerRendered, matchServerRoute, serverRoutesOf } from './server-routes';

const routes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Server },
  { path: 'news/:id', renderMode: RenderMode.Server, headers: { 'X-Kind': 'article' } },
  { path: 'news/special', renderMode: RenderMode.Prerender },
  { path: 'playground', renderMode: RenderMode.Client },
  { path: 'docs/**', renderMode: RenderMode.Server },
  { path: '**', renderMode: RenderMode.Server, status: 404 },
];

describe('matchServerRoute', () => {
  it('prefers exact segments over parameters over wildcards', () => {
    expect(matchServerRoute('/', routes)?.path).toBe('');
    expect(matchServerRoute('/news/7', routes)?.path).toBe('news/:id');
    expect(matchServerRoute('/news/special', routes)?.path).toBe('news/special');
    expect(matchServerRoute('/docs/a/b', routes)?.path).toBe('docs/**');
    expect(matchServerRoute('/nope', routes)?.path).toBe('**');
    expect(matchServerRoute('/news/7/extra', routes)?.path).toBe('**');
    expect(matchServerRoute('/x', [])).toBeUndefined();
  });
});

describe('isServerRendered', () => {
  it('allows server-rendered and unmatched paths only', () => {
    expect(isServerRendered('/', routes)).toBe(true);
    expect(isServerRendered('/playground', routes)).toBe(false);
    expect(isServerRendered('/news/special', routes)).toBe(false);
    expect(isServerRendered('/anything', [])).toBe(true);
  });
});

describe('serverRoutesOf', () => {
  it('recovers the token and reads the configured routes', () => {
    TestBed.configureTestingModule({ providers: [provideServerRendering(withRoutes(routes))] });

    expect(findServerRoutesToken()).not.toBeNull();
    expect(serverRoutesOf(TestBed.inject(EnvironmentInjector))).toBe(routes);
  });

  it('is empty without server routes', () => {
    expect(serverRoutesOf(TestBed.inject(EnvironmentInjector))).toEqual([]);
  });
});
