import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormField, form, maxLength, required, submit } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { Session, Visitor } from '../visitor';

/**
 * Excluded from snapshots (see `provideContinuousRendering` in the server config): every
 * request renders on demand with access to its cookies, so the page can be personal.
 */
@Component({
  selector: 'app-account',
  imports: [FormField],
  template: `
    <section class="max-w-2xl space-y-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Account</h1>
        <p class="mt-1 text-zinc-600 dark:text-zinc-400">
          This page is never snapshotted. It renders per request and reads the request's cookies
          on the server, which the shared live application cannot do.
        </p>
      </div>

      @if (visitor.session().signedIn) {
        <div class="rounded-xl bg-emerald-50 p-5 dark:bg-emerald-950/40">
          <p class="font-medium text-zinc-900 dark:text-zinc-50">Signed in as {{ visitor.session().name }}</p>
          <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            While signed in, every page is rendered per request for you. Look for
            <code class="text-sm">X-SSR-Mode: per-request</code> on the dashboard.
          </p>
          <button
            type="button"
            (click)="signOut()"
            class="mt-3 rounded-lg border border-emerald-700 px-4 py-2 font-medium text-emerald-900 hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
          >
            Sign out
          </button>
        </div>
      } @else {
        <form
          (submit)="signIn($event)"
          class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <label for="name" class="block font-medium text-zinc-900 dark:text-zinc-50">Sign in</label>
          <p id="name-hint" class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Sets a <code class="text-sm">session</code> cookie. Signed-in visitors bypass the
            snapshot store on every route.
          </p>
          <div class="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              id="name"
              type="text"
              autocomplete="name"
              aria-describedby="name-hint"
              [attr.aria-invalid]="showError()"
              [formField]="signInForm.name"
              class="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              placeholder="Your name"
            />
            <button
              type="submit"
              [disabled]="signInForm().submitting()"
              class="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-60"
            >
              Sign in
            </button>
          </div>
          @if (showError()) {
            <p role="alert" class="mt-2 text-sm text-amber-800 dark:text-amber-300">Enter between 1 and 40 characters.</p>
          }
        </form>
        <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p class="font-medium text-zinc-900 dark:text-zinc-50">Or stay anonymous with a light touch</p>
          <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            A <code class="text-sm">visitor</code> cookie keeps you on snapshots; the header greets
            you from the browser after hydration.
          </p>
          <button
            type="button"
            (click)="rememberVisitor()"
            class="mt-3 rounded-lg border border-zinc-300 px-4 py-2 font-medium text-zinc-900 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            Remember me as a visitor
          </button>
        </div>
      }
    </section>
  `,
})
export class AccountPage {
  protected readonly visitor = inject(Visitor);
  private readonly http = inject(HttpClient);
  protected readonly draft = signal({ name: '' });
  protected readonly signInForm = form(this.draft, (path) => {
    required(path.name);
    maxLength(path.name, 40);
  });

  protected showError(): boolean {
    const field = this.signInForm.name();
    return field.touched() && field.invalid();
  }

  protected async signIn(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.signInForm, async () => {
      const session = await firstValueFrom(this.http.post<Session>('/api/session', { name: this.draft().name }));
      this.visitor.session.set(session);
    });
  }

  protected async signOut(): Promise<void> {
    const session = await firstValueFrom(this.http.delete<Session>('/api/session'));
    this.visitor.session.set(session);
  }

  protected async rememberVisitor(): Promise<void> {
    const name = this.draft().name.trim() || 'visitor';
    const session = await firstValueFrom(this.http.post<Session>('/api/visitor', { name }));
    this.visitor.session.set(session);
  }
}
