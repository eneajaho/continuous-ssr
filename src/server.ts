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
  return (await import(/* @vite-ignore */ specifier)) as ServerEntry;
}

/**
 * Bootstraps the application once and keeps it alive. Resolves with the render loop, or
 * `undefined` when the built `index.server.html` is not available (for example under `ng serve`).
 */
export async function startContinuousRendering(): Promise<RenderLoop | undefined> {
  const indexPath = join(serverDistFolder, 'index.server.html');
  if (!existsSync(indexPath)) {
    console.warn(
      '[continuous-ssr] index.server.html not found next to the server bundle; per-request rendering only.',
    );
    return undefined;
  }

  const [document, entry] = await Promise.all([readFile(indexPath, 'utf8'), loadServerEntry()]);
  const renderer = await entry.ContinuousRenderer.create({
    bootstrap: entry.default,
    document,
    url: `${ORIGIN}/`,
  });

  const store = renderer.injector.get(entry.LiveDataStore);
  store.apply({
    counter: 0,
    message: 'Hello from the continuous renderer',
    updatedAt: new Date().toISOString(),
  });

  const criticalCss = new InlineCriticalCssProcessor((path) =>
    readFile(join(browserDistFolder, basename(path)), 'utf8'),
  );

  const loop = new RenderLoop({
    renderer,
    store: snapshots,
    routes: CONTINUOUS_ROUTES,
    postProcess: (html) => criticalCss.process(html),
    onError: (error, path) => console.error(`[continuous-ssr] render failed for ${path}`, error),
  });
  await loop.refresh();

  liveStore = store;
  renderLoop = loop;

  if (TICK_MS > 0) {
    setInterval(() => {
      store.increment(new Date().toISOString());
      void loop.refresh();
    }, TICK_MS).unref();
  }

  console.log(
    `[continuous-ssr] live application ready, ${snapshots.size} snapshot(s) at version ${loop.currentVersion}`,
  );
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
    res.status(400).json({ error: `message must be between 1 and ${MAX_MESSAGE_LENGTH} characters` });
    return;
  }
  if (!liveStore || !renderLoop) {
    res.status(503).json({ error: 'continuous renderer is not running' });
    return;
  }
  liveStore.setMessage(message, new Date().toISOString());
  void renderLoop.refresh();
  res.json(liveStore.snapshot());
});

app.post('/api/increment', (_req, res) => {
  if (!liveStore || !renderLoop) {
    res.status(503).json({ error: 'continuous renderer is not running' });
    return;
  }
  liveStore.increment(new Date().toISOString());
  void renderLoop.refresh();
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
    res.status(304).end();
    return;
  }
  res.status(200).send(snapshot.html);
});

/**
 * Everything else goes through Angular's per-request engine.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => {
      if (!response) {
        next();
        return;
      }
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
    console.log(`Node Express server listening on http://localhost:${port}`);
  });

  startContinuousRendering().catch((error) => {
    console.error('[continuous-ssr] failed to start the continuous renderer', error);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
