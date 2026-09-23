import { Service, signal } from '@angular/core';

/**
 * Server-side state shown on one page only. It is a plain signal: the about page transfers
 * what it needs through `transferredState`, so a change re-renders that page alone.
 */
@Service()
export class Announcements {
  readonly banner = signal<string | null>(null);
}
