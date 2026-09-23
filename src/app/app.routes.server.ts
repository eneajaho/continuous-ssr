import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Every route renders on the server per request when it is not served from a snapshot.
 * The continuous renderer in `src/server.ts` decides which routes get snapshots.
 */
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
