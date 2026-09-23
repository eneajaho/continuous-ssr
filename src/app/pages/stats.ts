import { Component, computed, inject, signal } from '@angular/core';
import { LiveDataStore } from '../live-data.store';

/** Rendered on the server inside a hydrate-on-interaction block: it hydrates only when touched. */
@Component({
  selector: 'app-stats-chart',
  template: `
    <figure class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <figcaption class="mb-3 font-medium text-zinc-900 dark:text-zinc-50">
        Ticks per bar, from the live counter
      </figcaption>
      <svg viewBox="0 0 320 120" class="h-32 w-full" role="img" aria-label="Bar chart of recent tick counts">
        @for (bar of bars(); track $index) {
          <rect
            [attr.x]="$index * 40 + 8"
            [attr.y]="120 - bar"
            width="24"
            [attr.height]="bar"
            rx="4"
            class="fill-emerald-700 dark:fill-emerald-500"
          />
        }
      </svg>
      <button
        type="button"
        (click)="highlight.update((v) => !v)"
        class="mt-3 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-800"
      >
        {{ highlight() ? 'Hydrated and interactive' : 'Click me to hydrate this block' }}
      </button>
    </figure>
  `,
})
export class StatsChart {
  private readonly store = inject(LiveDataStore);
  protected readonly highlight = signal(false);
  protected readonly bars = computed(() => {
    const total = this.store.counter();
    return Array.from({ length: 8 }, (_, i) => 20 + ((total * 7 + i * 13) % 90));
  });
}

/** Loaded in the browser on viewport only; the server renders the placeholder. */
@Component({
  selector: 'app-stats-details',
  template: `
    <p class="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
      Loaded in the browser when scrolled into view. The snapshot only carried the placeholder.
    </p>
  `,
})
export class StatsDetails {}

/**
 * Deferred blocks and incremental hydration. Both blocks come out of the same live app
 * serialization, re-rendered on every change, with their hydration data in transfer state.
 */
@Component({
  selector: 'app-stats',
  imports: [StatsChart, StatsDetails],
  template: `
    <section class="max-w-2xl space-y-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Stats</h1>
        <p class="mt-1 text-zinc-600 dark:text-zinc-400">
          Two <code class="text-sm">&#64;defer</code> blocks. The chart is server-rendered and
          hydrates on interaction; the details load on viewport from a placeholder.
        </p>
      </div>

      @defer (hydrate on interaction) {
        <app-stats-chart />
      } @placeholder {
        <p class="text-zinc-600 dark:text-zinc-400">Chart placeholder</p>
      }

      <div class="h-[60vh] rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        Scroll down for the deferred details.
      </div>

      @defer (on viewport) {
        <app-stats-details />
      } @placeholder {
        <p class="text-zinc-600 dark:text-zinc-400" data-testid="details-placeholder">Details placeholder</p>
      }
    </section>
  `,
})
export class StatsPage {}
