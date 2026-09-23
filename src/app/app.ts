import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Visitor } from './visitor';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly visitor = inject(Visitor);
  protected readonly links = [
    { path: '/', label: 'Dashboard', exact: true },
    { path: '/news', label: 'News', exact: false },
    { path: '/docs', label: 'Docs', exact: false },
    { path: '/about', label: 'About', exact: false },
    { path: '/account', label: 'Account', exact: false },
  ] as const;
}
