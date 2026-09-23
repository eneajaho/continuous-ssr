import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface NewsItem {
  readonly id: number;
  readonly title: string;
  readonly summary: string;
}

export interface NewsFeed {
  /** Server time the feed was produced, so freshness is visible. */
  readonly generatedAt: string;
  readonly tick: number;
  readonly items: readonly NewsItem[];
}

@Component({
  selector: 'app-news',
  imports: [DatePipe, RouterLink],
  template: `
    <section class="space-y-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">News</h1>
        <p class="mt-1 max-w-2xl text-zinc-600 dark:text-zinc-400">
          This page fetches <code class="rounded bg-zinc-200 px-1 py-0.5 text-sm dark:bg-zinc-800">/api/news</code>
          on the server. The response travels in this page's transfer state only, and it is
          fetched again every time the page is re-rendered.
        </p>
      </div>

      @if (feed.hasValue()) {
        <p class="text-sm text-zinc-600 dark:text-zinc-400" role="status">
          Feed generated at
          <time [attr.datetime]="feed.value().generatedAt">
            {{ feed.value().generatedAt | date: 'HH:mm:ss' : 'UTC' }} UTC
          </time>
          at tick {{ feed.value().tick }}
        </p>
        <ul class="grid gap-4 sm:grid-cols-2">
          @for (item of feed.value().items; track item.id) {
            <li class="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 class="font-medium text-zinc-900 dark:text-zinc-50" style="overflow-wrap: anywhere">
                <a
                  [routerLink]="['/news', item.id]"
                  class="rounded-md hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                >
                  {{ item.title }}
                </a>
              </h2>
              <p class="text-sm text-zinc-600 dark:text-zinc-400">{{ item.summary }}</p>
            </li>
          }
        </ul>
      } @else if (feed.error()) {
        <p role="alert" class="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          The news feed could not be loaded. Check that the server is running in continuous mode.
        </p>
      } @else {
        <p class="text-zinc-600 dark:text-zinc-400" role="status">Loading the feed</p>
      }
    </section>
  `,
})
export class NewsPage {
  protected readonly feed = httpResource<NewsFeed>(() => '/api/news');
}
