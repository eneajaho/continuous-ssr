import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID, REQUEST, Service, inject, signal } from '@angular/core';

export interface Session {
  readonly name: string | null;
  /** `session` cookie: the visitor is signed in and gets per-request renders everywhere. */
  readonly signedIn: boolean;
}

function cookie(header: string | null | undefined, name: string): string | null {
  const match = header?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Who is looking at the page, from two cookies with different treatment:
 *
 * - `visitor`: light personalisation. Snapshots are still served; the name is fetched in the
 *   browser after hydration, so no personal data ever enters a snapshot.
 * - `session`: signed in. The server refuses snapshots for these requests, Angular's
 *   per-request renderer sees the request, and the greeting is rendered on the server.
 *
 * The live application behind the snapshots has no request, so it renders the anonymous state.
 */
@Service()
export class Visitor {
  readonly session = signal<Session>({ name: null, signedIn: false });

  constructor() {
    const request = inject(REQUEST, { optional: true });
    if (request) {
      const header = request.headers.get('cookie');
      const sessionName = cookie(header, 'session');
      this.session.set(
        sessionName ? { name: sessionName, signedIn: true } : { name: cookie(header, 'visitor'), signedIn: false },
      );
    } else if (isPlatformBrowser(inject(PLATFORM_ID))) {
      inject(HttpClient)
        .get<Session>('/api/me', { transferCache: false })
        .subscribe({ next: (session) => this.session.set(session), error: () => undefined });
    }
  }
}
