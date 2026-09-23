# Continuous SSR — plan

Goal: keep one Angular server platform and `ApplicationRef` alive, re-serialize the live app whenever
its state changes, store the resulting HTML plus hydration state in a cache, and serve users from that
cache. The default Angular pipeline (bootstrap → render → destroy per request) stays as a fallback.

## How Angular renders today (verified in `@angular/platform-server` 22.1)

`renderApplication` = create platform with a fresh domino document → `bootstrap()` → `whenStable()` →
`ɵrenderInternal(platformRef, appRef)` → destroy platform. `ɵrenderInternal` is exported and does not
destroy anything, so it can be called repeatedly on a live app. It does three things that accumulate
on repeated calls and must be stripped before each snapshot:

| Artifact | Where | Why it matters |
|---|---|---|
| `<script id="<appId>-state">` | appended to `body` | browser reads it by id, first one wins → stale state |
| `<!--nghm-->` integrity marker | inserted as first child of `body` | duplicates |
| `<!--ngetn-->` empty-text markers | after empty text nodes | re-added on every pass |
| `window.__jsaction_bootstrap(...)` replay script | after the dispatch script | duplicates when event replay is on |

`ngh` attributes are set with `setAttribute` and hydration data is written to `TransferState` with
`set`, so those overwrite cleanly. In zoneless mode a signal write schedules a tick through a pending
task, so `await appRef.whenStable()` after a mutation runs change detection first.

## Architecture

```
                 ┌────────────────────────── server process ──────────────────────────┐
 data changes ──▶│ LiveDataStore (signals, inside the live app injector)               │
 (ticker, API)   │        │ invalidate()                                                │
                 │        ▼                                                             │
                 │ RenderLoop ──▶ ContinuousRenderer.render(url) ──▶ SnapshotStore      │
                 │   coalesces      navigate · strip artifacts ·        Map<path, html> │
                 │   refreshes      whenStable · ɵrenderInternal            ▲           │
                 │                                                          │           │
 GET /route ────▶│ Express: snapshot hit? serve HTML + ETag : fall back to AngularAppEngine
                 └────────────────────────────────────────────────────────────────────┘
```

Files:

- `src/server/serialization-artifacts.ts` — pure DOM function `stripSerializationArtifacts(doc, appId)`.
- `src/server/continuous-renderer.ts` — owns `platformServer` + `ApplicationRef`; `render(url)` serialized through a queue.
- `src/server/snapshot-store.ts` — in-memory `Map<pathname, Snapshot>`.
- `src/server/render-loop.ts` — `refreshAll()` / `invalidate()` with coalescing and a version counter.
- `src/server.ts` — wires renderer, ticker, `/api/state` endpoints, cache-first request handler, engine fallback.
- `src/app/live-data.store.ts` — `@Service` store with signals; server writes it into `TransferState`, browser reads it back.
- `src/app/pages/dashboard.ts`, `src/app/pages/about.ts` — lazy routes; dashboard shows the live state and posts a new message.

Constraints accepted: shared instance = no per-request context (public pages only); one live DOM per
platform so routes render sequentially; continuous mode runs against the built output (`index.server.html`
lives next to `server.mjs`), `ng serve` keeps the per-request engine.

## Testing

1. `ng test` (vitest, jsdom):
   - `serialization-artifacts.spec.ts` — strips every artifact, leaves app content and `ngh` attributes alone.
   - `render-loop.spec.ts` — fake renderer: renders all routes, bumps version, coalesces concurrent invalidations.
   - `continuous-renderer.spec.ts` — real `platformServer` + tiny component: two renders, state change visible,
     exactly one state script / one integrity marker, `ngh` present, `TransferState` reflects latest state.
   - `live-data.store.spec.ts`, page specs — TestBed.
2. `pnpm e2e` (`node --test`, against the built server): cache headers, state change → new snapshot,
   artifacts singular in served HTML, `ETag`/304, unknown route falls back to the engine, `/api/state`.
3. Manual browser check with Chrome DevTools: page hydrates without NG05xx errors, client-side nav works,
   posting a message updates the page and the next snapshot.

## Steps

1. Store + pages + routes (app side), server routes switched to `RenderMode.Server`.
2. Server modules (artifacts, renderer, store, loop) with unit tests.
3. `server.ts` wiring, `package.json` scripts, `strict` in tsconfig.
4. Build, run unit tests, run e2e, browser check, fix what breaks.
