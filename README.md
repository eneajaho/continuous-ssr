# Continuous SSR for Angular

**One live Angular application on the server. Snapshots per route. Re-rendered when state changes, served from cache.**

Angular's server-side rendering bootstraps a fresh application for every request, renders it once and
throws it away. This project keeps a single application alive instead: it navigates the live router,
serializes the live DOM (hydration annotations and transfer state included) into a snapshot per route,
and serves requests straight from that store. When the application's state changes, only the routes
that depend on it are re-rendered. Requests that need a personal render fall through to Angular's
regular per-request engine.

```
 data changes ──▶ live Angular app ──▶ dependency tracker ──▶ render loop ──▶ snapshot store ──▶ HTTP
 (signals,          one platform,        which routes         navigate,        memory / KV /       ETag,
  webhooks,         bootstrapped once    depend on what       scope state,     file                 304,
  ticker)                                changed?             serialize                             headers
```

Built on Angular 22 with the standalone application builder, Signal Forms, `httpResource`,
incremental hydration and `@angular/ssr`. The reusable engine lives in `src/continuous-ssr`; the rest
is a demo app that exercises every feature.

## Why

| Per-request SSR | Continuous SSR |
|---|---|
| Bootstrap, render, destroy on every request | Bootstrap once, serialize on change |
| Every request pays for data fetching | Requests are a cache lookup |
| Fresh data only when a request arrives | Snapshots refresh the moment state changes |
| No shared in-memory state between renders | Live state, feeds and services stay warm |
| Simple mental model | Same code; three rules to follow |

The bootstrap itself is a small share of SSR time. The larger win is that data fetching and rendering
leave the request path entirely, and that the server can react to its own data sources instead of
waiting for traffic.

## Quick start

```sh
pnpm install
pnpm build
pnpm serve:ssr:continuous-ssr        # http://localhost:4000
```

```sh
curl -i http://localhost:4000/                 # X-SSR-Mode: continuous, X-SSR-Version, ETag
curl -i http://localhost:4000/news/2           # one snapshot per article
curl -i http://localhost:4000/account          # X-SSR-Mode: per-request (excluded page)
curl -i -H 'Cookie: session=Ada' http://localhost:4000/   # signed in: per-request everywhere
curl -X POST localhost:4000/api/message -H 'content-type: application/json' -d '{"message":"hi"}'
curl http://localhost:4000/healthz
```

`pnpm start` runs `ng serve`; the engine starts there too, after the first request.

Environment variables for the built server:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `SSR_ORIGIN` | `http://localhost:$PORT` | Origin the live application believes it runs on |
| `SSR_ROLE` | `render` | `serve` answers from a shared store that another instance fills |
| `SNAPSHOT_STORE` | `memory` | `file:<dir>` writes snapshots (HTML plus metadata) to a directory |
| `SSR_LOG` | `info` | `debug` adds timings, stripped artifacts, transfer-state keys, dependency tracking |
| `ALLOWED_HOSTS` | `localhost` | Comma-separated hosts accepted by the per-request engine |
| `TICK_MS` | `5000` | Demo ticker that mutates the live state. `0` disables it. |

## Using it in an app

Three rules. Everything else is ordinary Angular.

### 1. Opt in once

```ts
// app.config.server.ts
providers: [
  provideServerRendering(withRoutes(serverRoutes)),
  provideContinuousRendering({
    routes: [{ path: 'news/:id', params: () => inject(NewsApi).ids().map((id) => ({ id })) }],
    exclude: ['/account'],
    refreshIntervalMs: 60_000,
    recycle: { afterRenders: 5_000, afterMs: 60 * 60_000, maxHeapMb: 512 },
  }),
]
```

Every static route in the router config gets a snapshot, nested children included. Parameterised
routes list their instances through `params`, which runs inside the live application before every
render run, so new instances appear and removed ones are dropped. Angular's own server routes are
honoured: `RenderMode.Client` and `Prerender` routes are never snapshotted, and a route's `status` and
`headers` apply to snapshot responses.

| Option | Default | Meaning |
|---|---|---|
| `routes` | `[]` | Extra paths, or `{ path, params }` entries expanded before each run |
| `discoverRoutes` | `true` | Discover static routes from the router config |
| `exclude` | `[]` | Exact paths or patterns that never get a snapshot |
| `autoRefresh` | `true` | Re-render when the live application changes |
| `granular` | `true` | Re-render only the routes whose dependencies changed |
| `debounceMs` | `50` | Quiet time after the last change before rendering |
| `refreshIntervalMs` | off | Timed full refresh, for changes the app cannot see |
| `recycle` | off | Replace the live application after N renders, M ms, or a heap size |
| `cacheControl` | `public, max-age=0, s-maxage=5, stale-while-revalidate=30` | Header on snapshot responses |

### 2. Keep state in the right primitive

```ts
@Service()
export class LiveDataStore {
  // App-wide: every snapshot carries it, every page hydrates it, a write re-renders everything.
  private readonly state = sharedState<LiveState>('live-state', EMPTY_LIVE_STATE);
}

export class AboutPage {
  // Route-local: travels with this route only, a change re-renders this route alone.
  protected readonly banner = transferredState('about-banner', () => inject(Announcements).banner());
}
```

Any signal a page's template reads is tracked through the signal graph and re-renders that page when
it changes, whether or not the page is currently active. Only `sharedState` and `transferredState`
also hydrate, so use them for anything rendered from server-side state.

### 3. Fetch route data as usual

`HttpClient` and `httpResource` work unchanged. A response is written into the route's transfer state,
travels only with that route's snapshot, and is fetched again each time the route re-renders. Head
tags set through `Meta` are scoped the same way.

Data the application cannot see change, such as a CMS or an external API, needs a nudge:
`engine.refresh('webhook', paths)` from a webhook, or a polling service. `refreshIntervalMs` is the
safety net.

### The server entry

`src/server.ts` loads the built application bundle next to itself (sharing one copy of Angular with
the per-request engine), starts the engine, and mounts it in front of Angular's engine:

```ts
const engine = await entry.ContinuousAppEngine.start({
  bootstrap: entry.default,
  document,                      // index.server.html from Angular's app manifest
  origin: 'https://example.com',
  store: new KeyValueSnapshotStore(redisAdapter),          // or FileSnapshotStore, or omit for memory
  role: 'render',                                          // 'serve' for read-only instances
  prepare: (injector) => injector.get(Feed).connect(),     // runs for every fresh instance
  shouldServeSnapshot: (request) => !hasSessionCookie(request),
  onSnapshotStored: (snapshot) => cdn.purge(snapshot.path),
  readBrowserAsset: (name) => manifestAsset(name),         // enables critical CSS inlining
  log,
});

app.use(async (req, res, next) => {
  const response = await engine.handle(createWebRequestFromNodeRequest(req));
  response ? writeResponseToNodeResponse(response, res) : next();   // then Angular's engine
});
```

`engine.refresh(reason, paths?)`, `engine.recycle()`, `engine.health()`, `engine.snapshots()` and
`engine.injector` cover operations.

## What the demo shows

| Page | Demonstrates |
|---|---|
| `/` Dashboard | `sharedState`, a Signal Forms mutation, event replay |
| `/news` | `httpResource` data scoped to the route and re-fetched per render |
| `/news/:id` | Parameterised route with instances listed from the feed, `Meta` tags per route |
| `/stats` | `@defer` with incremental hydration and viewport loading |
| `/docs/*` | A layout route with nested static children, all discovered |
| `/about` | `transferredState`, granular re-render, a server-route header |
| `/account` | Excluded from snapshots, per request with cookies; signing in switches every route to per-request |
| `/playground` | `RenderMode.Client`, never snapshotted |
| `/legacy`, `/nowhere` | Redirect and 404 wildcard, both answered per request |

API: `GET /healthz`, `POST /api/webhook {paths?}`, `POST /api/recycle`, `POST /api/message {message}`,
`POST /api/announce {text}`, `POST /api/session {name}` / `DELETE`, `POST /api/visitor {name}`,
`GET /api/state`, `GET /api/news`, `GET /api/news/:id`, `GET /api/me`.

## How it works

The engine leans on a handful of Angular internals, each verified against the Angular source and
covered by tests:

- **Serialize without destroying.** `@angular/platform-server` exports `ɵrenderInternal`, the step
  that annotates for hydration and serializes the DOM. The renderer calls it repeatedly on a live
  `ApplicationRef` and strips what accumulates between calls: the transfer-state script, the `nghm`
  integrity marker, `ngetn`/`ngtns` text markers, the event-replay script.
- **Transfer state per route.** `TransferState` is one store per application. Keys are attributed
  to the route that wrote them, evicted before that route re-renders (so the HTTP transfer cache
  fetches again instead of answering from the store), and withheld from other routes' snapshots.
  Angular switches the HTTP transfer cache off after the first stabilization; its state token is
  recovered from `ɵwithHttpTransferCache`'s providers and switched back on.
- **Dependency tracking.** After a route renders, its views' reactive consumers are read from the
  `LView` arrays and their producers are watched with `createWatch` from
  `@angular/core/primitives/signals`. Marks made while the renderer itself navigates are dropped,
  and a fresh-component route reuse strategy keeps parameterised routes from sharing instances.
- **Head scoping.** `<meta>`, `<link>` and `<title>` are captured before bootstrap and restored
  before every navigation; component styles stay with Angular.
- **Server routes.** The `withRoutes` token is recovered the same way, so render modes, `status`
  and `headers` from the app's server routes apply to snapshots.
- **Recycling.** A fresh platform is bootstrapped, prepared and warmed up in the background while
  the old one keeps serving; then they swap and the old one is destroyed.

Files: `renderer.ts`, `serialization-artifacts.ts`, `transfer-state-scope.ts`, `http-transfer-cache.ts`,
`route-dependencies.ts`, `head-scope.ts`, `server-routes.ts`, `render-loop.ts`, `snapshot-store.ts`,
`file-snapshot-store.ts`, `config.ts`, `shared-state.ts`, `engine.ts`. See [PLAN.md](./PLAN.md).

## Reading the logs

Every line is `time level [scope] message  key=value ...`: `ssr` for the Express server,
`ssr.renderer` for the live application, `ssr.loop` for the render loop, `ssr.deps` for tracking.

```
16:07:48.125 info  [ssr] live state changed  source=api:message message="hello"
16:07:48.178 info  [ssr.loop] render run started  version=3 routes=9 of=9 scope=all reasons=shared-state
16:07:48.189 info  [ssr.loop] snapshot stored  path=/ version=3 size=16.0kB changed=true took=10.8ms
16:07:48.212 info  [ssr.loop] render run finished  version=3 snapshots=9 failures=0 took=34.4ms rerun=false
16:07:50.201 info  [ssr.loop] render run started  version=4 routes=1 of=9 scope=targeted reasons=dependency:/about
16:07:51.766 info  [ssr] request served  path=/ mode=continuous status=200 version=4 age=1.5s
```

`SSR_LOG=debug` adds per-render timings, the transfer-state keys each snapshot carried and how many
were evicted or withheld, and the producers tracked per route.

## Tests

```sh
pnpm test    # 79 unit tests (vitest), including real platform-server renderer and engine tests
pnpm e2e     # builds, starts the server and checks every feature over HTTP (17 tests)
```

## Limits and caveats

- Snapshots are identical for every visitor. Personal pages stay per request (`exclude`,
  `shouldServeSnapshot`), or personalise in the browser after hydration.
- One live application has one DOM, so routes render sequentially. Several instances can share a
  store, with one rendering and the others in `serve` role.
- Changes that arrive while a route is being rendered are picked up by the next change or the
  periodic refresh.
- Development builds print Angular's "duplicate serialization of the server-side application state"
  warning after the first render: its guard against serializing an app twice, which this engine does
  on purpose. Production builds do not emit it.
- The engine relies on exported-but-prefixed (`ɵ`) Angular APIs and on the `LView` layout. Every
  assumption is pinned by a test, so an Angular upgrade that changes one fails loudly.
