import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, effect, inject, input } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { NewsItem } from './news';

export interface NewsArticle extends NewsItem {
  readonly body: string;
  readonly generatedAt: string;
}

/**
 * A parameterised route (`/news/:id`). Each instance gets its own snapshot; the ids come
 * from the `params` function next to `provideContinuousRendering`.
 */
@Component({
  selector: 'app-news-article',
  imports: [DatePipe, RouterLink],
  template: `
    <article class="max-w-2xl space-y-6">
      <a
        routerLink="/news"
        class="inline-block rounded-md text-sm font-medium text-emerald-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:text-emerald-300"
      >
        Back to news
      </a>
      @if (article.hasValue()) {
        <div>
          <h1 class="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50" style="overflow-wrap: anywhere">
            {{ article.value().title }}
          </h1>
          <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Article {{ id() }}, rendered from data fetched at
            <time [attr.datetime]="article.value().generatedAt">
              {{ article.value().generatedAt | date: 'HH:mm:ss' : 'UTC' }} UTC
            </time>
          </p>
        </div>
        <p class="text-zinc-800 dark:text-zinc-200">{{ article.value().body }}</p>
      } @else if (article.error()) {
        <p role="alert" class="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Article {{ id() }} could not be loaded.
        </p>
      } @else {
        <p class="text-zinc-600 dark:text-zinc-400" role="status">Loading article {{ id() }}</p>
      }
    </article>
  `,
})
export class NewsArticlePage {
  /** Bound from the route parameter through `withComponentInputBinding`. */
  readonly id = input.required<string>();
  protected readonly article = httpResource<NewsArticle>(() => `/api/news/${encodeURIComponent(this.id())}`);
  private readonly meta = inject(Meta);

  constructor() {
    // Head tags belong to this route's snapshot only; the engine resets the head between routes.
    effect(() => {
      const article = this.article.value();
      if (article) {
        this.meta.updateTag({ name: 'description', content: article.summary });
        this.meta.updateTag({ property: 'og:title', content: article.title });
      }
    });
  }
}
