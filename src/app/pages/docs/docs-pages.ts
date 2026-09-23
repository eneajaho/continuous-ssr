import { Component } from '@angular/core';

const heading = 'text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50';
const body = 'mt-2 text-zinc-700 dark:text-zinc-300';

@Component({
  selector: 'app-docs-overview',
  template: `
    <h1 class="${heading}">Docs overview</h1>
    <p class="${body}">
      Three nested static routes under one layout. Discovery found them from the router config
      without any listing, and each one is its own snapshot.
    </p>
  `,
})
export class DocsOverviewPage {}

@Component({
  selector: 'app-docs-getting-started',
  template: `
    <h1 class="${heading}">Getting started</h1>
    <ol class="mt-2 list-decimal space-y-2 pl-5 text-zinc-700 dark:text-zinc-300">
      <li>Add <code class="text-sm">provideContinuousRendering()</code> to the server config.</li>
      <li>Keep app-wide state in <code class="text-sm">sharedState</code>, route data in <code class="text-sm">httpResource</code>.</li>
      <li>Start the engine from the server entry and mount <code class="text-sm">engine.handle</code>.</li>
    </ol>
  `,
})
export class DocsGettingStartedPage {}

@Component({
  selector: 'app-docs-api',
  template: `
    <h1 class="${heading}">API</h1>
    <dl class="mt-2 space-y-3 text-zinc-700 dark:text-zinc-300">
      <div><dt class="font-medium text-zinc-900 dark:text-zinc-50">POST /api/webhook</dt><dd>Re-render everything, or only the <code class="text-sm">paths</code> in the body.</dd></div>
      <div><dt class="font-medium text-zinc-900 dark:text-zinc-50">POST /api/recycle</dt><dd>Replace the live application with a fresh one.</dd></div>
      <div><dt class="font-medium text-zinc-900 dark:text-zinc-50">GET /healthz</dt><dd>Instance age, renders, recycles, last run and snapshot ages.</dd></div>
    </dl>
  `,
})
export class DocsApiPage {}
