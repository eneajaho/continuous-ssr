import { ɵInlineCriticalCssProcessor as InlineCriticalCssProcessor } from '@angular/ssr';
import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { LiveDataStore } from './app/live-data.store';
import type { ContinuousBootstrap, ContinuousRenderer } from './server/continuous-renderer';
import { createLogger, isLogLevel, kb, ms } from './server/log';
import { RenderLoop } from './server/render-loop';
import { SnapshotStore } from './server/snapshot-store';

const serverDistFolder = import.meta.dirname;
const browserDistFolder = join(serverDistFolder, '../browser');

/** Routes that get a continuously refreshed snapshot. Everything else renders per request. */
const CONTINUOUS_ROUTES = ['/', '/about'] as const;
/** Interval of the demo ticker that mutates state on the server. `0` disables it. */
const TICK_MS = Number(process.env['TICK_MS'] ?? 5000);
/** Origin the live application believes it runs on. */
const ORIGIN = process.env['SSR_ORIGIN'] ?? `http://localhost:${process.env['PORT'] || 4000}`;
const MAX_MESSAGE_LENGTH = 120;
/** Hosts the per-request engine accepts, on top of `security.allowedHosts` in angular.json. */
const ALLOWED_HOSTS = (process.env['ALLOWED_HOSTS'] ?? 'localhost')
  .split(',')
  .map((host) => host.trim())
  .filter((host) => host.length > 0);
/** `SSR_LOG=debug` adds per-step timings, stripped artifacts and transfer-state keys. */
const LOG_LEVEL = isLogLevel(process.env['SSR_LOG']) ? process.env['SSR_LOG'] : 'info';

const log = createLogger('ssr', LOG_LEVEL);
const app = express();
const angularApp = new AngularNodeAppEngine({ allowedHosts: ALLOWED_HOSTS });
const snapshots = new SnapshotStore();

let renderLoop: RenderLoop | undefined;
let liveStore: LiveDataStore | undefined;

/** What the built `main.server.mjs` exports: everything `src/main.server.ts` exports. */
interface ServerEntry {
  readonly default: ContinuousBootstrap;
  readonly ContinuousRenderer: typeof ContinuousRenderer;
  readonly LiveDataStore: typeof LiveDataStore;
}

/**
 * Loads the application bundle at runtime, next to this file. Importing it statically would
 * bundle a second copy of Angular into the server entry; this way the continuous renderer and
 * the per-request engine share one.
 */
async function loadServerEntry(): Promise<ServerEntry> {
  const specifier = new URL('./main.server.mjs', import.meta.url).href;
  const started = performance.now();
  const entry = (await import(/* @vite-ignore */ specifier)) as ServerEntry;
  log.debug('application bundle loaded', { took: ms(performance.now() - started) });
  return entry;
}

/**
 * Bootstraps the application once and keeps it alive. Resolves with the render loop, or
 * `undefined` when the built `index.server.html` is not available (for example under `ng serve`).
 */
export async function startContinuousRendering(): Promise<RenderLoop | undefined> {
  const indexPath = join(serverDistFolder, 'index.server.html');
  if (!existsSync(indexPath)) {
    log.warn('index.server.html not found next to the server bundle; per-request rendering only', {
      indexPath,
    });
    return undefined;
  }

  const started = performance.now();
  log.info('starting continuous renderer', {
    routes: CONTINUOUS_ROUTES.join(','),
    origin: ORIGIN,
    tickMs: TICK_MS,
    logLevel: LOG_LEVEL,
  });

  const [document, entry] = await Promise.all([readFile(indexPath, 'utf8'), loadServerEntry()]);
  const renderer = await entry.ContinuousRenderer.create({
    bootstrap: entry.default,
    document,
    url: `${ORIGIN}/`,
    log: log.child('renderer'),
  });

  const store = renderer.injector.get(entry.LiveDataStore);
  store.apply({
    counter: 0,
    message: 'Hello from the continuous renderer',
    updatedAt: new Date().toISOString(),
  });
  log.debug('live state seeded', { ...store.snapshot() });

  const criticalCss = new InlineCriticalCssProcessor((path) =>
    readFile(join(browserDistFolder, basename(path)), 'utf8'),
  );

  const loop = new RenderLoop({
    renderer,
    store: snapshots,
    routes: CONTINUOUS_ROUTES,
    postProcess: async (html, path) => {
      const before = performance.now();
      const processed = await criticalCss.process(html);
      log.debug('critical css inlined', {
        path,
        took: ms(performance.now() - before),
        delta: kb(processed.length - html.length),
      });
      return processed;
    },
    log: log.child('loop'),
  });
  await loop.refresh('warm-up');

  liveStore = store;
  renderLoop = loop;

  if (TICK_MS > 0) {
    setInterval(() => {
      store.increment(new Date().toISOString());
      log.debug('tick', { counter: store.counter() });
      void loop.refresh('tick');
    }, TICK_MS).unref();
  }

  log.info('continuous renderer ready', {
    snapshots: snapshots.size,
    version: loop.currentVersion,
    took: ms(performance.now() - started),
  });
  return loop;
}

/**
 * Demo API that mutates the live state.
 */
app.get('/api/state', (_req, res) => {
  res.json({
    continuous: renderLoop !== undefined,
    version: renderLoop?.currentVersion ?? 0,
    state: liveStore?.snapshot() ?? null,
    snapshots: snapshots.summaries(),
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
  if (!liveStore || !renderLoop) {
    res.status(503).json({ error: 'continuous renderer is not running' });
    return;
  }
  liveStore.setMessage(message, new Date().toISOString());
  log.info('live state changed', { source: 'api:message', message });
  void renderLoop.refresh('api:message');
  res.json(liveStore.snapshot());
});

app.post('/api/increment', (_req, res) => {
  if (!liveStore || !renderLoop) {
    res.status(503).json({ error: 'continuous renderer is not running' });
    return;
  }
  liveStore.increment(new Date().toISOString());
  log.info('live state changed', { source: 'api:increment', counter: liveStore.counter() });
  void renderLoop.refresh('api:increment');
  res.json(liveStore.snapshot());
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
 * Serve pages straight from the snapshot store when one exists for the path.
 */
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }
  const snapshot = snapshots.get(req.path);
  if (!snapshot) {
    next();
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('ETag', snapshot.etag);
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=30');
  res.setHeader('X-SSR-Mode', 'continuous');
  res.setHeader('X-SSR-Version', String(snapshot.version));
  res.setHeader('X-SSR-Rendered-At', snapshot.renderedAt);

  if (req.headers['if-none-match'] === snapshot.etag) {
    log.info('request served', { path: req.path, mode: 'continuous', status: 304, version: snapshot.version });
    res.status(304).end();
    return;
  }
  log.info('request served', {
    path: req.path,
    mode: 'continuous',
    status: 200,
    version: snapshot.version,
    age: ms(Date.now() - Date.parse(snapshot.renderedAt)),
  });
  res.status(200).send(snapshot.html);
});

/**
 * Everything else goes through Angular's per-request engine.
 */
app.use((req, res, next) => {
  const started = performance.now();
  angularApp
    .handle(req)
    .then((response) => {
      if (!response) {
        log.debug('request not handled by angular', { path: req.path, method: req.method });
        next();
        return;
      }
      log.info('request served', {
        path: req.path,
        mode: 'per-request',
        status: response.status,
        took: ms(performance.now() - started),
      });
      res.setHeader('X-SSR-Mode', 'per-request');
      return writeResponseToNodeResponse(response, res);
    })
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }
    log.info('listening', { url: `http://localhost:${port}` });
  });

  startContinuousRendering().catch((error) => {
    log.error('failed to start the continuous renderer', undefined, error);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
