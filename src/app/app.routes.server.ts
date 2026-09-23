import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Angular's server routes. The continuous engine honours them: only `RenderMode.Server`
 * routes can become snapshots, and a matched route's `status` and `headers` apply to
 * snapshot responses as they do to per-request ones.
 */
export const serverRoutes: ServerRoute[] = [
  { path: 'playground', renderMode: RenderMode.Client },
  { path: 'about', renderMode: RenderMode.Server, headers: { 'X-Section': 'about' } },
  { path: '', renderMode: RenderMode.Server },
  { path: 'news', renderMode: RenderMode.Server },
  { path: 'news/:id', renderMode: RenderMode.Server },
  { path: 'stats', renderMode: RenderMode.Server },
  { path: 'docs/**', renderMode: RenderMode.Server },
  { path: 'account', renderMode: RenderMode.Server },
  { path: 'legacy', renderMode: RenderMode.Server },
  { path: '**', renderMode: RenderMode.Server, status: 404 },
];
