# Continuous SSR

An Angular 22 SSR app that keeps **one Angular application alive on the server** and re-serializes it
into a snapshot cache whenever its state changes, instead of bootstrapping, rendering and destroying an
app for every request. Requests are answered from the snapshot store; anything without a snapshot
falls back to Angular's regular per-request engine.

See [PLAN.md](./PLAN.md) for the design, the Angular internals it relies on and the test strategy.

## Run it

```sh
pnpm install
pnpm build
pnpm serve:ssr:continuous-ssr        # http://localhost:4000
```

Then:

```sh
curl -i http://localhost:4000/                 # X-SSR-Mode: continuous, served from the snapshot store
curl -i http://localhost:4000/news             # snapshot whose transfer state holds only its own API response
curl -i http://localhost:4000/about/           # X-SSR-Mode: per-request, rendered by the engine
curl http://localhost:4000/api/state           # live state, snapshot versions
curl -X POST http://localhost:4000/api/message -H 'content-type: application/json' -d '{"message":"hi"}'
```

Environment variables for the built server:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `TICK_MS` | `5000` | Demo ticker that increments the counter. `0` disables it. |
| `SSR_ORIGIN` | `http://localhost:$PORT` | Origin the live application believes it runs on |
| `ALLOWED_HOSTS` | `localhost` | Comma-separated hosts accepted by the per-request engine |
| `SSR_LOG` | `info` | `debug` adds per-step timings, stripped artifacts and transfer-state keys; `warn` or `silent` quiets it |

`ng serve` keeps the default per-request rendering; the continuous engine needs the built output.

## Using it in an app

The reusable part lives in `src/continuous-ssr`. From the app's point of view there are three rules.

**1. Opt in once**, in the server config:

```ts
providers: [
  provideServerRendering(withRoutes(serverRoutes)),
  provideContinuousRendering(), // routes?: ['/', '/news'], autoRefresh?: true, debounceMs?: 50
]
```

Every static route in the router config gets a snapshot. Parameterised routes and lazily loaded
child configs do not, unless listed in `routes`.

**2. Keep app-wide live state in `sharedState`** inside a service:

```ts
@Service()
export class LiveDataStore {
  private readonly state = sharedState<LiveState>('live-state', EMPTY_LIVE_STATE);
  increment() { this.state.update((s) => ({ ...s, counter: s.counter + 1 })); }
}
```

Writing to it is all it takes: the server mirrors it into `TransferState` so every snapshot carries
it and the browser hydrates from it, and the engine notices the change and re-renders. Any
`effect` in a root service triggers a re-render the same way. A plain `signal` that only a template
reads does not trigger a re-render while that page is not the active route.

**3. Fetch route data with `HttpClient` or `httpResource` as usual.** The response is written into
the route's transfer state, travels only with that route's snapshot, and is fetched again each
time the route is re-rendered. Data the app cannot see change (an external API) needs a nudge:
`engine.refresh('webhook')` from the server, or a service that polls.

The server entry (`src/server.ts`) is thin: it loads the built app bundle, calls
`ContinuousAppEngine.start`, and mounts `engine.handle(request)` in front of Angular's engine.

## How it works

- `renderer.ts` creates the server platform once, bootstraps the app once and exposes `render(url)`,
  which navigates the live router, strips the artifacts of the previous serialization, waits for
  stability and calls Angular's exported `ɵrenderInternal`.
- `serialization-artifacts.ts` removes the transfer-state script, the `nghm` integrity marker, the
  `ngetn`/`ngtns` text markers and any event-replay script before each pass.
- `render-loop.ts` renders all routes into `snapshot-store.ts`, coalescing bursts of refreshes into
  at most one follow-up run.
- `transfer-state-scope.ts` keeps `TransferState` per route: keys are attributed to the route that
  wrote them, evicted before that route re-renders, and withheld from other routes' snapshots.
  Shared keys, Angular's `__ngh*` keys and keys written between renders go everywhere.
- `http-transfer-cache.ts` switches Angular's HTTP transfer cache back on before each render;
  Angular turns it off after the first stabilization, which a per-request app never outlives.
- `engine.ts` ties it together: route discovery, warm-up, `handle()` with `ETag`/304, and the
  automatic re-render, which watches `ApplicationRef.isStable` for the app settling after a change
  of its own while ignoring the renderer's own navigations.

## Reading the logs

Every line is `time level [scope] message  key=value ...`. Scopes: `ssr` for the Express server,
`ssr.renderer` for the live application, `ssr.loop` for the render loop.

```
15:26:21.795 info  [ssr] live state changed  source=api:message message="logged hello"
15:26:21.796 debug [ssr] application changed, scheduling re-render  debounce=50.0ms
15:26:21.846 info  [ssr.loop] render run started  version=2 routes=3 reasons=app-changed
15:26:21.848 debug [ssr.renderer] navigated live router  from=/about to=/ took=2.3ms
15:26:21.849 info  [ssr.renderer] serialized live application  url=/ render=4 navigation=/about->/ stable=0.9ms serialize=0.4ms total=3.8ms size=7.2kB
15:26:21.849 debug [ssr.renderer] transfer state scoped  route=/ evicted=0 written=1 withheld=1 httpCache=active serialized=live-state,__nghData__
15:26:21.854 info  [ssr.loop] snapshot stored  path=/ version=2 size=15.5kB changed=true took=9.1ms
15:26:21.876 info  [ssr.loop] render run finished  version=2 snapshots=3 failures=0 took=30.6ms rerun=false
15:26:22.766 info  [ssr] request served  path=/ mode=continuous status=200 version=2 age=0.9s
```

`reasons` on a run lists every refresh that was coalesced into it, `rerun=true` means another run
follows because state changed mid-run, and `transfer state scoped` shows how many keys were evicted
before the route re-rendered, written during it, withheld from other routes, and exactly which keys
went into the page's state script.

## Tests

```sh
pnpm test    # unit tests (vitest), including real platform-server renderer and engine tests
pnpm e2e     # builds, starts the server and checks caching, hydration output, scoping and fallbacks
```

## Limits

The shared instance has no per-request context, so only pages that look the same for every visitor
belong in the snapshot list. One platform has one DOM, so routes render sequentially. Recycle the
engine periodically in a long-running deployment.
