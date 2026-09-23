import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/**
 * A layout route with children. Snapshot discovery walks nested static routes, so `/docs`,
 * `/docs/getting-started` and `/docs/api` each get a snapshot.
 */
@Component({
  selector: 'app-docs-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="grid gap-8 md:grid-cols-[12rem_1fr]">
      <nav aria-label="Docs" class="md:sticky md:top-4 md:self-start">
        <ul class="flex flex-wrap gap-1 md:flex-col">
          @for (link of links; track link.path) {
            <li>
              <a
                [routerLink]="link.path"
                routerLinkActive="bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                [routerLinkActiveOptions]="{ exact: true }"
                ariaCurrentWhenActive="page"
                class="block rounded-md px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {{ link.label }}
              </a>
            </li>
          }
        </ul>
      </nav>
      <div class="min-w-0">
        <router-outlet />
      </div>
    </div>
  `,
})
export class DocsLayout {
  protected readonly links = [
    { path: '/docs', label: 'Overview' },
    { path: '/docs/getting-started', label: 'Getting started' },
    { path: '/docs/api', label: 'API' },
  ] as const;
}
