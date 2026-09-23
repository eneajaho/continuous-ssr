import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The wildcard route. Its server route carries `status: 404`; the engine renders it per request. */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <section class="max-w-2xl space-y-4">
      <h1 class="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Page not found</h1>
      <p class="text-zinc-600 dark:text-zinc-400">
        This response was rendered per request with a 404 status; unknown paths never become snapshots.
      </p>
      <a
        routerLink="/"
        class="inline-block rounded-md font-medium text-emerald-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:text-emerald-300"
      >
        Back to the dashboard
      </a>
    </section>
  `,
})
export class NotFoundPage {}
