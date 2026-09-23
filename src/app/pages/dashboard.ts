import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormField, form, maxLength, required, submit } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { LiveDataStore, LiveState } from '../live-data.store';

type PublishStatus = 'idle' | 'sent' | 'error';

@Component({
  selector: 'app-dashboard',
  imports: [DatePipe, FormField],
  template: `
    <section class="space-y-8">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Live dashboard
        </h1>
        <p class="mt-1 max-w-2xl text-zinc-600 dark:text-zinc-400">
          This page was serialized from a long-lived Angular instance on the server. Every value
          below came out of the cached snapshot and was hydrated without a second render.
        </p>
      </div>

      <dl class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div class="flex flex-col gap-3 rounded-xl border border-transparent bg-emerald-50 p-5 dark:bg-emerald-950/40">
          <div class="flex items-center gap-3">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white"
              aria-hidden="true"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 6v6l4 2" /><circle cx="12" cy="12" r="9" />
              </svg>
            </span>
            <dt class="font-medium text-zinc-900 dark:text-zinc-50">Server ticks</dt>
          </div>
          <dd class="flex flex-1 flex-col justify-between gap-2">
            <span class="text-4xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {{ store.counter() }}
            </span>
            <span class="text-sm text-zinc-600 dark:text-zinc-400">
              Incremented by the server on every tick
            </span>
          </dd>
        </div>

        <div class="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div class="flex items-center gap-3">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              aria-hidden="true"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <dt class="font-medium text-zinc-900 dark:text-zinc-50">Message</dt>
          </div>
          <dd class="flex flex-1 flex-col justify-between gap-2">
            <span class="text-lg text-zinc-900 dark:text-zinc-50" style="overflow-wrap: anywhere">
              {{ store.message() }}
            </span>
            <span class="text-sm text-zinc-600 dark:text-zinc-400">Set through the API below</span>
          </dd>
        </div>

        <div class="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div class="flex items-center gap-3">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              aria-hidden="true"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            </span>
            <dt class="font-medium text-zinc-900 dark:text-zinc-50">Last change</dt>
          </div>
          <dd class="flex flex-1 flex-col justify-between gap-2">
            <span class="text-lg tabular-nums text-zinc-900 dark:text-zinc-50">
              @if (store.updatedAt()) {
                <time [attr.datetime]="store.updatedAt()">
                  {{ store.updatedAt() | date: 'HH:mm:ss' : 'UTC' }} UTC
                </time>
              } @else {
                Not yet
              }
            </span>
            <span class="text-sm text-zinc-600 dark:text-zinc-400">Server time of the last mutation</span>
          </dd>
        </div>
      </dl>

      <form
        (submit)="publish($event)"
        class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <label for="message" class="block font-medium text-zinc-900 dark:text-zinc-50">
          Publish a new message
        </label>
        <p id="message-hint" class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Changes the live state on the server. The next snapshot carries it to every visitor.
        </p>
        <div class="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            id="message"
            type="text"
            autocomplete="off"
            aria-describedby="message-hint"
            [attr.aria-invalid]="showError()"
            [formField]="messageForm.message"
            class="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
            placeholder="Something worth re-rendering"
          />
          <button
            type="submit"
            [disabled]="messageForm().submitting()"
            class="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-60"
          >
            Publish
          </button>
        </div>
        @if (showError()) {
          <p role="alert" class="mt-2 text-sm text-amber-800 dark:text-amber-300">
            Enter between 1 and 120 characters.
          </p>
        }
        @if (status() === 'sent') {
          <p role="status" class="mt-2 text-sm text-emerald-800 dark:text-emerald-300">
            Published. The server has re-rendered the snapshot with your message.
          </p>
        } @else if (status() === 'error') {
          <p role="alert" class="mt-2 text-sm text-amber-800 dark:text-amber-300">
            The server refused the update. Check that it is running in continuous mode.
          </p>
        }
      </form>
    </section>
  `,
})
export class DashboardPage {
  protected readonly store = inject(LiveDataStore);
  private readonly http = inject(HttpClient);

  protected readonly draft = signal({ message: '' });
  protected readonly messageForm = form(this.draft, (path) => {
    required(path.message);
    maxLength(path.message, 120);
  });
  protected readonly status = signal<PublishStatus>('idle');

  protected showError(): boolean {
    const field = this.messageForm.message();
    return field.touched() && field.invalid();
  }

  protected async publish(event: Event): Promise<void> {
    event.preventDefault();
    this.status.set('idle');
    await submit(this.messageForm, async () => {
      try {
        const next = await firstValueFrom(
          this.http.post<LiveState>('/api/message', { message: this.draft().message }),
        );
        this.store.apply(next);
        this.draft.set({ message: '' });
        this.messageForm().reset();
        this.status.set('sent');
      } catch {
        this.status.set('error');
      }
    });
  }
}
