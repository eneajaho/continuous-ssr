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
    path: 'about',
    title: 'About · Continuous SSR',
    loadComponent: () => import('./pages/about').then((m) => m.AboutPage),
  },
];
