import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { transferredState } from '../../continuous-ssr';
import { Announcements } from '../announcements';

@Component({
  selector: 'app-about',
  imports: [RouterLink],
  template: `
    <article class="max-w-2xl space-y-6">
      @if (banner(); as text) {
        <p
          role="status"
          class="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
          style="overflow-wrap: anywhere"
        >
          {{ text }}
        </p>
      }
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
        <li>Each snapshot goes into a store keyed by route.</li>
        <li>
          Requests are answered straight from that store. Routes without a snapshot fall back to
          the regular per-request renderer.
        </li>
      </ol>
      <h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-50">What each page shows</h2>
      <ul class="list-disc space-y-2 pl-5 text-zinc-800 dark:text-zinc-200">
        <li><strong>Dashboard</strong>: app-wide live state through <code class="text-sm">sharedState</code>, a form that mutates it, event replay.</li>
        <li><strong>News</strong>: route data through <code class="text-sm">httpResource</code>, transferred with this route only and fetched again on every re-render.</li>
        <li><strong>News article</strong>: a parameterised route with one snapshot per article, instances listed from the feed.</li>
        <li><strong>About</strong>: this banner is route-local server state through <code class="text-sm">transferredState</code>; changing it re-renders this page alone. Its server route adds an <code class="text-sm">X-Section</code> header.</li>
        <li><strong>Docs</strong>: a layout route with three nested static children, all discovered and snapshotted.</li>
        <li><strong>Webhook</strong>: <code class="text-sm">POST /api/webhook</code> re-renders everything or just the listed paths, for data the app cannot watch.</li>
        <li><strong>Account</strong>: excluded from snapshots, rendered per request with the request's cookies; signing in switches every route to per-request rendering.</li>
        <li><a routerLink="/playground" class="font-medium text-emerald-800 hover:underline dark:text-emerald-300">Playground</a>: <code class="text-sm">RenderMode.Client</code> in the server routes, so it is never snapshotted and may use browser APIs.</li>
        <li><a routerLink="/legacy" class="font-medium text-emerald-800 hover:underline dark:text-emerald-300">/legacy</a> redirects, <a routerLink="/nowhere" class="font-medium text-emerald-800 hover:underline dark:text-emerald-300">/nowhere</a> is the 404 page: both are answered per request.</li>
      </ul>
      <p class="text-zinc-600 dark:text-zinc-400">
        Look at the <code class="rounded bg-zinc-200 px-1 py-0.5 text-sm dark:bg-zinc-800">X-SSR-Mode</code>
        response header to see which path served a page.
      </p>
    </article>
  `,
})
export class AboutPage {
  private readonly announcements = inject(Announcements);
  protected readonly banner = transferredState('about-banner', () => this.announcements.banner());
}
