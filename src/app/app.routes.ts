import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Live dashboard · Continuous SSR',
    loadComponent: () => import('./pages/dashboard').then((m) => m.DashboardPage),
  },
  {
    path: 'about',
    title: 'About · Continuous SSR',
    loadComponent: () => import('./pages/about').then((m) => m.AboutPage),
  },
];
