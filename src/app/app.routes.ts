import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Live dashboard · Continuous SSR',
    loadComponent: () => import('./pages/dashboard').then((m) => m.DashboardPage),
  },
  {
    path: 'news',
    title: 'News · Continuous SSR',
    loadComponent: () => import('./pages/news').then((m) => m.NewsPage),
  },
  {
    path: 'news/:id',
    title: 'Article · Continuous SSR',
    loadComponent: () => import('./pages/news-article').then((m) => m.NewsArticlePage),
  },
  {
    path: 'account',
    title: 'Account · Continuous SSR',
    loadComponent: () => import('./pages/account').then((m) => m.AccountPage),
  },
  {
    path: 'about',
    title: 'About · Continuous SSR',
    loadComponent: () => import('./pages/about').then((m) => m.AboutPage),
  },
  {
    path: 'playground',
    title: 'Playground · Continuous SSR',
    loadComponent: () => import('./pages/playground').then((m) => m.PlaygroundPage),
  },
  /** Old address; redirects are skipped by snapshot discovery and answered by the engine. */
  { path: 'legacy', redirectTo: 'about' },
  {
    path: '**',
    title: 'Not found · Continuous SSR',
    loadComponent: () => import('./pages/not-found').then((m) => m.NotFoundPage),
  },
];
