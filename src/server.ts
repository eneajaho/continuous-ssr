import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  createWebRequestFromNodeRequest,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LiveDataStore, LiveState } from './app/live-data.store';
import type { ContinuousBootstrap } from './continuous-ssr/renderer';
import type { ContinuousAppEngine, FileSnapshotStore, SnapshotStore } from './continuous-ssr/server';
import { createLogger, isLogLevel, ms } from './continuous-ssr/log';

const serverDistFolder = import.meta.dirname;
const browserDistFolder = join(serverDistFolder, '../browser');

const PORT = process.env['PORT'] || 4000;
/** Origin the live application believes it runs on. */
const ORIGIN = process.env['SSR_ORIGIN'] ?? `http://localhost:${PORT}`;
/** Hosts the per-request engine accepts, on top of `security.allowedHosts` in angular.json. */
const ALLOWED_HOSTS = (process.env['ALLOWED_HOSTS'] ?? 'localhost')
  .split(',')
  .map((host) => host.trim())
  .filter((host) => host.length > 0);
/** `SSR_LOG=debug` adds per-step timings, stripped artifacts and transfer-state keys. */
const LOG_LEVEL = isLogLevel(process.env['SSR_LOG']) ? process.env['SSR_LOG'] : 'info';
/** Demo ticker that mutates state on the server. `0` disables it. */
const TICK_MS = Number(process.env['TICK_MS'] ?? 5000);
/** `render` keeps snapshots fresh; `serve` only answers from a store another instance fills. */
const SSR_ROLE = process.env['SSR_ROLE'] === 'serve' ? 'serve' : 'render';
/** `memory` (default) or `file:<directory>` for a store shared with other processes or a CDN origin. */
const SNAPSHOT_STORE = process.env['SNAPSHOT_STORE'] ?? 'memory';
const MAX_MESSAGE_LENGTH = 120;

const log = createLogger('ssr', LOG_LEVEL);
const app = express();
const angularApp = new AngularNodeAppEngine({ allowedHosts: ALLOWED_HOSTS });

let continuous: ContinuousAppEngine | undefined;
let liveStore: LiveDataStore | undefined;
/** Demo: the last known live state, carried over to a recycled application. */
let lastKnownState: LiveState | undefined;

/** What the built `main.server.mjs` exports: everything `src/main.server.ts` exports. */
interface ServerEntry {
  readonly default: ContinuousBootstrap;
  readonly ContinuousAppEngine: typeof ContinuousAppEngine;
  readonly FileSnapshotStore: typeof FileSnapshotStore;
  readonly LiveDataStore: typeof LiveDataStore;
}

function createSnapshotStore(entry: ServerEntry): SnapshotStore | undefined {
  if (SNAPSHOT_STORE.startsWith('file:')) {
    return new entry.FileSnapshotStore(SNAPSHOT_STORE.slice('file:'.length));
  }
  return undefined;
}

/**
 * Starts the continuous engine from the built application bundle next to this file. Importing
 * the bundle statically would duplicate Angular into the server entry; loading it at runtime
 * shares one copy with the per-request engine. Resolves with nothing under `ng serve`, where
 * there is no built `index.server.html`, and per-request rendering carries on alone.
 */
async function startContinuousRendering(): Promise<ContinuousAppEngine | undefined> {
  const indexPath = join(serverDistFolder, 'index.server.html');
  if (!existsSync(indexPath)) {
    log.warn('index.server.html not found next to the server bundle; per-request rendering only');
    return undefined;
  }
  const started = performance.now();
  const specifier = new URL('./main.server.mjs', import.meta.url).href;
  const [document, entry] = await Promise.all([
    readFile(indexPath, 'utf8'),
    import(/* @vite-ignore */ specifier) as Promise<ServerEntry>,
  ]);
  log.debug('application bundle loaded', { took: ms(performance.now() - started) });

  const engine = await entry.ContinuousAppEngine.start({
    bootstrap: entry.default,
    document,
    origin: ORIGIN,
    role: SSR_ROLE,
    store: createSnapshotStore(entry),
    readBrowserAsset: (fileName) => readFile(join(browserDistFolder, fileName), 'utf8'),
    // Demo: seed the live state of every fresh application (at start and after a recycle).
    // A real app's services would fetch their own data on bootstrap; every change they make
    // afterwards re-renders the snapshots automatically.
    prepare: (injector) => {
      liveStore = injector.get(entry.LiveDataStore);
      liveStore.apply(
        lastKnownState ?? {
          counter: 0,
          message: 'Hello from the continuous renderer',
          updatedAt: new Date().toISOString(),
        },
      );
    },
    log,
  });
  continuous = engine;
  if (engine.role === 'serve') {
    return engine;
  }

  if (TICK_MS > 0) {
    setInterval(() => {
      liveStore?.increment(new Date().toISOString());
      lastKnownState = liveStore?.snapshot();
      log.debug('tick', { counter: liveStore?.counter() });
    }, TICK_MS).unref();
  }
  return engine;
}

/**
 * Demo API. Mutating the store is all it takes; the engine notices the change and re-renders.
 */
app.get('/api/state', async (_req, res) => {
  res.json({
    continuous: continuous !== undefined,
    role: continuous?.role ?? null,
    version: continuous?.version ?? 0,
    state: liveStore?.snapshot() ?? null,
    snapshots: (await continuous?.snapshots()) ?? [],
  });
});

/** The news page fetches this on the server; each call produces a fresh feed. */
function newsItems() {
  const tick = liveStore?.counter() ?? 0;
  return [
    { id: 1, title: 'Snapshot cache keeps serving', summary: `Snapshot version ${continuous?.version ?? 0} is live.` },
    { id: 2, title: 'Live application stays warm', summary: `The store has ticked ${tick} times since start.` },
    { id: 3, title: 'Transfer state is scoped', summary: 'This feed only travels with the news page.' },
  ];
}

app.get('/api/news', (_req, res) => {
  res.json({ generatedAt: new Date().toISOString(), tick: liveStore?.counter() ?? 0, items: newsItems() });
});

/** One article; the `/news/:id` snapshots are listed from the feed above. */
app.get('/api/news/:id', (req, res) => {
  const item = newsItems().find((candidate) => String(candidate.id) === req.params['id']);
  if (!item) {
    res.status(404).json({ error: 'no such article' });
    return;
  }
  res.json({
    ...item,
    generatedAt: new Date().toISOString(),
    body: `${item.summary} Every article is its own snapshot with its own transfer state, listed from the feed before each render run.`,
  });
});

app.post('/api/message', express.json(), (req, res) => {
  const body: unknown = req.body;
  const message =
    typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
      ? body.message.trim()
      : '';
  if (message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
    log.warn('rejected message', { length: message.length });
    res.status(400).json({ error: `message must be between 1 and ${MAX_MESSAGE_LENGTH} characters` });
    return;
  }
  if (!liveStore) {
    res.status(503).json({ error: 'continuous renderer is not running' });
    return;
  }
  liveStore.setMessage(message, new Date().toISOString());
  lastKnownState = liveStore.snapshot();
  log.info('live state changed', { source: 'api:message', message });
  res.json(liveStore.snapshot());
});

app.post('/api/increment', (_req, res) => {
  if (!liveStore) {
    res.status(503).json({ error: 'continuous renderer is not running' });
    return;
  }
  liveStore.increment(new Date().toISOString());
  lastKnownState = liveStore.snapshot();
  log.info('live state changed', { source: 'api:increment', counter: liveStore.counter() });
  res.json(liveStore.snapshot());
});

/** Replaces the live application with a fresh one; the recycle policy does this on its own too. */
app.post('/api/recycle', async (_req, res) => {
  if (!continuous || continuous.role !== 'render') {
    res.status(503).json({ error: 'continuous renderer is not running' });
    return;
  }
  await continuous.recycle('api');
  res.json(await continuous.health());
});

/** Liveness and readiness in one: 503 until snapshots exist or when rendering keeps failing. */
app.get('/healthz', async (_req, res) => {
  if (!continuous) {
    res.status(503).json({ ok: false, reason: 'continuous engine not started' });
    return;
  }
  const health = await continuous.health();
  res.status(health.ok ? 200 : 503).json(health);
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Snapshots first, then Angular's per-request engine for everything else.
 */
app.use(async (req, res, next) => {
  const response = await continuous?.handle(createWebRequestFromNodeRequest(req)).catch(next);
  if (response) {
    writeResponseToNodeResponse(response, res).catch(next);
    return;
  }
  const started = performance.now();
  angularApp
    .handle(req)
    .then((rendered) => {
      if (!rendered) {
        next();
        return;
      }
      log.info('request served', {
        path: req.path,
        mode: 'per-request',
        status: rendered.status,
        took: ms(performance.now() - started),
      });
      res.setHeader('X-SSR-Mode', 'per-request');
      return writeResponseToNodeResponse(rendered, res);
    })
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  app.listen(PORT, (error) => {
    if (error) {
      throw error;
    }
    log.info('listening', { url: `http://localhost:${PORT}` });
  });

  startContinuousRendering().catch((error) => {
    log.error('failed to start the continuous renderer', undefined, error);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
