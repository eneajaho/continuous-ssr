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

`ng serve` keeps the default per-request rendering; the continuous renderer needs the built output.

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

## Tests

```sh
pnpm test    # unit tests (vitest), including a real platform-server renderer test
pnpm e2e     # builds, starts the server and checks caching, hydration output and fallbacks
```

## Limits

The shared instance has no per-request context, so only pages that look the same for every visitor
belong in the snapshot list. One platform has one DOM, so routes render sequentially. Recycle the
renderer periodically in a long-running deployment.
