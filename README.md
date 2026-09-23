# Continuous SSR

An Angular 22 SSR app that keeps **one Angular application alive on the server** and re-serializes it
into a snapshot store whenever its state changes, instead of bootstrapping, rendering and destroying an
app for every request. Requests are answered from the snapshot store; anything without a snapshot
falls back to Angular's regular per-request engine.

See [PLAN.md](./PLAN.md) for the design, the Angular internals it relies on and the test strategy.

## Run it

```sh
pnpm install
pnpm build
pnpm serve:ssr:continuous-ssr        # http://localhost:4000
pnpm start                           # ng serve on :4200 also runs the engine, after its first request
```

Environment variables for the built server:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `SSR_ORIGIN` | `http://localhost:$PORT` | Origin the live application believes it runs on |
| `SSR_ROLE` | `render` | `serve` answers from a shared store that another instance fills |
| `SNAPSHOT_STORE` | `memory` | `file:<dir>` writes snapshots (HTML plus metadata) to a directory |
| `SSR_LOG` | `info` | `debug` adds per-step timings, stripped artifacts, transfer-state keys and dependency tracking |
| `ALLOWED_HOSTS` | `localhost` | Comma-separated hosts accepted by the per-request engine |
| `TICK_MS` | `5000` | Demo ticker that increments the counter. `0` disables it. |

## Using it in an app

The reusable part lives in `src/continuous-ssr`: `index.ts` is safe to import from application code,
`server.ts` is the engine. From the app's point of view there are three rules.

**1. Opt in once**, in the server config:

```ts
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

Every static route in the router config, nested ones included, gets a snapshot. Parameterised
routes list their instances through `params`, which runs inside the live app before every render
run (new instances appear, removed ones are dropped). Angular's own server routes are honoured:
`RenderMode.Client` and `Prerender` routes are never snapshotted, and a route's `status` and
`headers` apply to snapshot responses. Other options: `autoRefresh`, `debounceMs`, `granular`,
`discoverRoutes`, `cacheControl`.

**2. Keep state in the right primitive:**

```ts
@Service()
export class LiveDataStore {
  private readonly state = sharedState<LiveState>('live-state', EMPTY_LIVE_STATE); // app-wide
}

export class AboutPage {
  protected readonly banner = transferredState('about-banner', () => inject(Announcements).banner()); // route-local
}
```

`sharedState` is for state every page needs: the server mirrors it into `TransferState`, the
browser hydrates from it, and a write re-renders every snapshot. `transferredState` is for
server state one page shows: it travels with that route only and a change re-renders that route
alone. Any signal a page's template reads is tracked the same way through the signal graph, but
only these two also hydrate, so use them for anything rendered from server-side state.

**3. Fetch route data with `HttpClient` or `httpResource` as usual.** The response is written into
the route's transfer state, travels only with that route's snapshot, and is fetched again each
time the route is re-rendered. Head tags a page sets through `Meta` travel with it the same way.

Data the app cannot see change (a CMS, an external API) needs a nudge: `engine.refresh('webhook',
paths)` from a webhook, or a polling service. `refreshIntervalMs` is the safety net.

The server entry (`src/server.ts`) loads the built app bundle, calls `ContinuousAppEngine.start`,
and mounts `engine.handle(request)` in front of Angular's engine. Its options: `store`, `role`,
`prepare(injector)` for every fresh instance, `shouldServeSnapshot(request)` for per-visitor
policy, `onSnapshotStored` for CDN purges, `readBrowserAsset` for critical CSS.

## What the demo pages show

| Page | Demonstrates |
|---|---|
| `/` Dashboard | `sharedState`, a Signal Forms mutation, event replay |
| `/news` | `httpResource` data scoped to the route and re-fetched per render |
| `/news/:id` | Parameterised route, instances listed from the feed, `Meta` tags per route |
| `/stats` | `@defer` with incremental hydration and viewport loading |
| `/docs/*` | A layout route with nested static children, all discovered |
| `/about` | `transferredState`, granular re-render, a server-route header |
| `/account` | Excluded from snapshots, per-request with cookies; signing in switches every route to per-request |
| `/playground` | `RenderMode.Client`, never snapshotted |
| `/legacy`, `/nowhere` | Redirect and 404 wildcard, both per request |

API: `GET /healthz`, `POST /api/webhook {paths?}`, `POST /api/recycle`, `POST /api/message`,
`POST /api/announce {text}`, `POST /api/session {name}` / `DELETE`, `POST /api/visitor {name}`.

## How it works

- `renderer.ts` creates the server platform once, bootstraps the app once and exposes `render(url)`:
  navigate the live router, reset head tags and route-owned transfer state, strip the artifacts of
  the previous serialization, wait for stability, call Angular's exported `ɵrenderInternal`.
- `transfer-state-scope.ts` attributes `TransferState` keys to the route that wrote them, evicts
  them before that route re-renders (so the HTTP transfer cache fetches again) and withholds other
  routes' keys during serialization. `http-transfer-cache.ts` keeps Angular's transfer cache on,
  which Angular switches off after the first stabilization.
- `route-dependencies.ts` collects the reactive producers each route's views read and watches
  them, so a change re-renders only the routes that depend on it.
- `render-loop.ts` renders routes into a `SnapshotStore` (`snapshot-store.ts`: memory, key/value
  adapter for Redis-like backends, `file-snapshot-store.ts`), coalescing bursts and targeted refreshes.
- `engine.ts` ties it together: route resolution, warm-up, `handle()` with ETag/304 and server-route
  status/headers, automatic re-render, periodic refresh, health, and recycling (a fresh instance is
  prepared and warmed in the background, then swapped in).

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

In development builds Angular warns about "duplicate serialization of the server-side
application state" on every render after the first: its guard against serializing an app twice,
which this engine does on purpose. Production builds do not emit it.

## Tests

```sh
pnpm test    # unit tests (vitest), including real platform-server renderer and engine tests
pnpm e2e     # builds, starts the server and checks every feature over HTTP
```

## Limits

Snapshots are the same for every visitor; personal pages stay per request. One live application
has one DOM, so routes render sequentially. Changes that arrive while a route is being rendered are
picked up by the next change or the periodic refresh.
