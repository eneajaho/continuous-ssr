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
| `TICK_MS` | `5000` | Demo ticker that increments the counter and re-renders. `0` disables it. |
| `SSR_ORIGIN` | `http://localhost:$PORT` | Origin the live application believes it runs on |
| `ALLOWED_HOSTS` | `localhost` | Comma-separated hosts accepted by the per-request engine |
| `SSR_LOG` | `info` | `debug` adds per-step timings, stripped artifacts and transfer-state keys; `warn` or `silent` quiets it |

`ng serve` keeps the default per-request rendering; the continuous renderer needs the built output.

## Reading the logs

Every line is `time level [scope] message  key=value ...`. Scopes: `ssr` for the Express server,
`ssr.renderer` for the live application, `ssr.loop` for the render loop.

```
14:26:21.795 info  [ssr] live state changed  source=api:message message="logged hello"
14:26:21.795 info  [ssr.loop] render run started  version=2 routes=2 reasons=api:message
14:26:21.797 debug [ssr.renderer] navigated live router  from=/about to=/ took=2.3ms
14:26:21.798 debug [ssr.renderer] stripped previous serialization artifacts  stateScript=true markerComments=1 replayScripts=1
14:26:21.799 info  [ssr.renderer] serialized live application  url=/ render=3 navigation=/about->/ stable=0.9ms serialize=0.4ms total=3.8ms size=7.2kB
14:26:21.799 debug [ssr.renderer] transfer state serialized  keys=2 names=live-state,__nghData__
14:26:21.804 info  [ssr.loop] snapshot stored  path=/ version=2 size=15.5kB changed=true took=9.1ms
14:26:21.826 info  [ssr.loop] render run finished  version=2 snapshots=2 failures=0 took=30.6ms rerun=false
14:26:21.766 info  [ssr] request served  path=/ mode=continuous status=200 version=1 age=1.89s
```

`reasons` on a run lists every refresh that was coalesced into it, `rerun=true` means another run
follows because state changed mid-run, and `transfer state scoped` shows how many keys were
evicted before the route re-rendered, written during it, withheld from other routes, and exactly
which keys went into the page's state script.

## How it works

- `src/server/continuous-renderer.ts` creates the server platform once, bootstraps the app once and
  exposes `render(url)`, which navigates the live router, strips the artifacts of the previous
  serialization, waits for stability and calls Angular's exported `ɵrenderInternal`.
- `src/server/serialization-artifacts.ts` removes the transfer-state script, the `nghm` integrity
  marker, the `ngetn`/`ngtns` text markers and any event-replay script before each pass.
- `src/server/render-loop.ts` renders all configured routes into `src/server/snapshot-store.ts`,
  coalescing bursts of invalidations into at most one follow-up run.
- `src/server.ts` wires it together: cache-first request handler with `ETag`/304, demo API, engine
  fallback. The renderer is loaded through the built `main.server.mjs` so it shares one copy of
  Angular with the engine.
- `src/app/live-data.store.ts` is the live state; on the server an effect mirrors it into
  `TransferState`, in the browser the store hydrates from it.
- `src/server/transfer-state-scope.ts` keeps `TransferState` per route. In a long-lived app the
  store is shared by every route, so without it the news page's API response would ship inside
  the dashboard's snapshot, and the server would keep answering from the cached response instead
  of fetching again. The scope attributes keys to the route that wrote them, evicts a route's
  own keys before it is re-rendered, and withholds other routes' keys while a snapshot is
  serialized. Keys in `sharedStateKeys` (the live state) and Angular's own `__ngh*` keys go
  everywhere; keys written between renders are treated as app-wide too.
- `src/server/http-transfer-cache.ts` switches Angular's HTTP transfer cache back on before each
  render. Angular turns it off after the first stabilization, which a per-request app never
  outlives; this one does.

## Tests

```sh
pnpm test    # unit tests (vitest), including a real platform-server renderer test
pnpm e2e     # builds, starts the server and checks caching, hydration output and fallbacks
```

## Limits

The shared instance has no per-request context, so only pages that look the same for every visitor
belong in the snapshot list. One platform has one DOM, so routes render sequentially. Recycle the
renderer periodically in a long-running deployment.
