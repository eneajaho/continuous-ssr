import { Component, signal } from '@angular/core';

/**
 * Rendered in the browser only (`RenderMode.Client` in the server routes). The engine sees
 * that and never snapshots it, so browser-only APIs are safe here.
 */
@Component({
  selector: 'app-playground',
  template: `
    <section class="max-w-2xl space-y-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Playground</h1>
        <p class="mt-1 text-zinc-600 dark:text-zinc-400">
          Client-only route. Nothing here touches the server, so it can use browser APIs freely.
        </p>
      </div>
      <div class="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          type="button"
          (click)="bump()"
          class="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          Count
        </button>
        <p class="text-zinc-900 dark:text-zinc-50">
          Clicked <span class="tabular-nums">{{ count() }}</span> times, remembered in this browser.
        </p>
      </div>
      <p class="text-sm text-zinc-600 dark:text-zinc-400">Viewport {{ viewport() }}</p>
    </section>
  `,
})
export class PlaygroundPage {
  protected readonly count = signal(Number(readStorage('playground-count') ?? 0));
  protected readonly viewport = signal(`${window.innerWidth}×${window.innerHeight}`);

  protected bump(): void {
    this.count.update((value) => value + 1);
    try {
      localStorage.setItem('playground-count', String(this.count()));
    } catch {
      // Storage may be unavailable; the counter still works for this page view.
    }
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
