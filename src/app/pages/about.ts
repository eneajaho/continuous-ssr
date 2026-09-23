import { Component } from '@angular/core';

@Component({
  selector: 'app-about',
  template: `
    <article class="prose-zinc max-w-2xl space-y-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          How this server works
        </h1>
        <p class="mt-1 text-zinc-600 dark:text-zinc-400">
          Angular normally bootstraps a fresh application for every request, renders it once and
          destroys it. This project keeps one application alive instead.
        </p>
      </div>
      <ol class="list-decimal space-y-3 pl-5 text-zinc-800 dark:text-zinc-200">
        <li>At startup the server creates one platform and bootstraps the app once.</li>
        <li>
          Whenever the live state changes, the render loop waits for the app to become stable and
          serializes the live DOM again, hydration annotations and transfer state included.
        </li>
        <li>Each snapshot goes into an in-memory store keyed by route.</li>
        <li>
          Requests are answered straight from that store. Routes without a snapshot fall back to
          the regular per-request renderer.
        </li>
      </ol>
      <p class="text-zinc-600 dark:text-zinc-400">
        Look at the <code class="rounded bg-zinc-200 px-1 py-0.5 text-sm dark:bg-zinc-800">X-SSR-Mode</code>
        response header to see which path served a page.
      </p>
    </article>
  `,
})
export class AboutPage {}
