// End-to-end checks against the built server. Run `pnpm build` first, or use `pnpm e2e`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';

const PORT = Number(process.env.E2E_PORT ?? 4123);
const BASE = `http://localhost:${PORT}`;
const TICK_MS = 500;

let server;
const logs = [];

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

async function waitFor(check, { timeout = 30_000, interval = 100, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`timed out waiting for ${label}${last ? `: ${last}` : ''}\n${logs.join('')}`);
}

async function state() {
  const response = await fetch(`${BASE}/api/state`);
  assert.equal(response.status, 200);
  return response.json();
}

function transferState(html) {
  const match = /<script id="ng-state" type="application\/json">(.*?)<\/script>/s.exec(html);
  assert.ok(match, 'transfer state script present');
  return JSON.parse(match[1]);
}

before(async () => {
  server = spawn('node', ['dist/continuous-ssr/server/server.mjs'], {
    env: { ...process.env, PORT: String(PORT), TICK_MS: String(TICK_MS), SSR_ORIGIN: BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => logs.push(String(chunk)));
  server.stderr.on('data', (chunk) => logs.push(String(chunk)));
  await waitFor(async () => (await state()).continuous, { label: 'continuous renderer' });
});

after(() => {
  server?.kill();
});

test('serves the dashboard from a snapshot with intact hydration output', async () => {
  const response = await fetch(`${BASE}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-ssr-mode'), 'continuous');
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.ok(response.headers.get('etag'));
  assert.match(html, /<app-root[^>]*ngh="\d+"/);
  assert.ok(html.includes('ng-server-context="ssr-continuous"'));
  assert.ok(html.includes('<app-dashboard'));
  assert.ok(html.includes('Hello from the continuous renderer'));
  assert.equal(occurrences(html, 'id="ng-state"'), 1);
  assert.equal(occurrences(html, '<!--nghm-->'), 1);
  assert.equal(transferState(html)['live-state'].message, 'Hello from the continuous renderer');
});

test('serves the about page from its own snapshot', async () => {
  const response = await fetch(`${BASE}/about`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-ssr-mode'), 'continuous');
  assert.ok(html.includes('<app-about'));
  assert.ok(!html.includes('<app-dashboard'));
  assert.ok(html.includes('<title>About · Continuous SSR</title>'));
});

test('answers conditional requests with 304', async () => {
  const first = await fetch(`${BASE}/about`);
  const etag = first.headers.get('etag');

  const second = await fetch(`${BASE}/about`, { headers: { 'If-None-Match': etag } });

  assert.equal(second.status, 304);
});

test('a published message reaches the next snapshot without duplicated artifacts', async () => {
  const message = `e2e message ${Date.now()}`;
  const before = await state();

  const post = await fetch(`${BASE}/api/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  assert.equal(post.status, 200);
  assert.equal((await post.json()).message, message);

  const html = await waitFor(
    async () => {
      const response = await fetch(`${BASE}/`);
      const text = await response.text();
      return text.includes(message) ? text : null;
    },
    { label: 'snapshot containing the new message' },
  );

  assert.equal(occurrences(html, 'id="ng-state"'), 1);
  assert.equal(occurrences(html, '<!--nghm-->'), 1);
  assert.equal(transferState(html)['live-state'].message, message);
  assert.ok(!html.includes('Hello from the continuous renderer'));
  assert.ok((await state()).version > before.version);
});

test('the server ticker keeps producing new snapshot versions', async () => {
  const start = await state();

  const later = await waitFor(
    async () => {
      const current = await state();
      return current.version >= start.version + 2 ? current : null;
    },
    { label: 'two more render versions' },
  );

  assert.ok(later.state.counter > start.state.counter);
  const html = await (await fetch(`${BASE}/`)).text();
  assert.equal(transferState(html)['live-state'].counter, later.state.counter);
});

test('rejects invalid messages', async () => {
  const response = await fetch(`${BASE}/api/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '' }),
  });

  assert.equal(response.status, 400);
});

test('paths without a snapshot fall back to per-request rendering', async () => {
  const response = await fetch(`${BASE}/about/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-ssr-mode'), 'per-request');
  assert.ok(html.includes('<app-about'));
  assert.ok(html.includes('ng-server-context="ssr"'));
});

function httpCacheEntries(state) {
  return Object.entries(state).filter(
    ([key, value]) => !key.startsWith('__ngh') && key !== 'live-state' && value && typeof value === 'object' && 'u' in value,
  );
}

test('the news page carries its API response in transfer state and re-fetches on every render', async () => {
  const first = await fetch(`${BASE}/news`);
  const firstHtml = await first.text();
  assert.equal(first.headers.get('x-ssr-mode'), 'continuous');
  assert.ok(firstHtml.includes('<app-news'));
  assert.ok(firstHtml.includes('Transfer state is scoped'));

  const entries = httpCacheEntries(transferState(firstHtml));
  assert.equal(entries.length, 1, 'exactly one cached HTTP response');
  const [, cached] = entries[0];
  assert.match(cached.u, /\/api\/news$/);
  assert.equal(cached.b.items.length, 3);
  const firstVersion = Number(first.headers.get('x-ssr-version'));

  const later = await waitFor(
    async () => {
      const response = await fetch(`${BASE}/news`);
      return Number(response.headers.get('x-ssr-version')) >= firstVersion + 2 ? await response.text() : null;
    },
    { label: 'two newer news snapshots' },
  );
  const [, laterCached] = httpCacheEntries(transferState(later))[0];
  assert.notEqual(laterCached.b.generatedAt, cached.b.generatedAt, 'feed was fetched again');
});

test('other pages never carry the news API response', async () => {
  const version = (await state()).version;
  await waitFor(async () => (await state()).version >= version + 1, { label: 'a run after news rendered' });

  for (const path of ['/', '/about']) {
    const html = await (await fetch(`${BASE}${path}`)).text();
    const keys = Object.keys(transferState(html));
    assert.equal(httpCacheEntries(transferState(html)).length, 0, `${path} has no HTTP cache entry (${keys})`);
    assert.ok(keys.includes('live-state'), `${path} keeps the shared live state`);
  }
});

test('reports health and survives a recycle without losing snapshots or state', async () => {
  const before = await (await fetch(`${BASE}/healthz`)).json();
  assert.equal(before.ok, true);
  assert.equal(before.role, 'render');
  assert.equal(before.instance.recycles, 0);
  const message = `kept across recycle ${Date.now()}`;
  await fetch(`${BASE}/api/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  const recycled = await fetch(`${BASE}/api/recycle`, { method: 'POST' });
  assert.equal(recycled.status, 200);
  const health = await recycled.json();
  assert.equal(health.instance.recycles, 1);
  assert.equal(health.instance.recycling, false);
  assert.ok(health.version >= before.version, 'version never goes backwards');

  const page = await fetch(`${BASE}/`);
  assert.equal(page.headers.get('x-ssr-mode'), 'continuous');
  const html = await page.text();
  assert.ok(html.includes(message), 'state carried over by prepare()');
  assert.equal(occurrences(html, 'id="ng-state"'), 1);

  // The fresh instance keeps re-rendering on changes.
  const version = (await state()).version;
  await fetch(`${BASE}/api/increment`, { method: 'POST' });
  await waitFor(async () => (await state()).version > version, { label: 'a run after recycle' });
});

test('parameterised routes get one snapshot per instance with their own transfer state', async () => {
  const response = await fetch(`${BASE}/news/2`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-ssr-mode'), 'continuous');
  assert.ok(html.includes('<app-news-article'));
  assert.ok(html.includes('Live application stays warm'));

  const entries = httpCacheEntries(transferState(html));
  assert.equal(entries.length, 1, 'only the article response, not the feed the params came from');
  assert.match(entries[0][1].u, /\/api\/news\/2$/);

  const snapshots = (await state()).snapshots.map((s) => s.path);
  assert.deepEqual(snapshots.filter((p) => p.startsWith('/news/')).sort(), ['/news/1', '/news/2', '/news/3']);
  assert.equal((await fetch(`${BASE}/news/999`)).headers.get('x-ssr-mode'), 'per-request');
});

test('route-local state re-renders only the route that depends on it', async () => {
  const text = `Only the about page changed ${Date.now()}`;
  // Post right after a tick run so the announcement gets a debounce window of its own.
  const tickVersion = (await state()).version;
  await waitFor(async () => (await state()).version > tickVersion, { label: 'a tick run' });

  const response = await fetch(`${BASE}/api/announce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  assert.equal(response.status, 200);

  const targeted = await waitFor(
    async () => {
      const health = await (await fetch(`${BASE}/healthz`)).json();
      return /dependency:\/about/.test(health.lastRun.reasons) ? health.lastRun : null;
    },
    { label: 'a run triggered by the about dependency', timeout: 5_000 },
  );
  assert.equal(targeted.routes, 1, `only one route rendered (${targeted.reasons})`);

  const html = await (await fetch(`${BASE}/about`)).text();
  assert.ok(html.includes(text), 'about snapshot carries the announcement');
  assert.equal(transferState(html)['about-banner'], text, 'banner travels in the about transfer state');
  assert.equal(transferState(await (await fetch(`${BASE}/`)).text())['about-banner'], undefined, 'not in other snapshots');
});

test('personal pages and signed-in visitors render per request, light visitors stay on snapshots', async () => {
  const account = await fetch(`${BASE}/account`);
  assert.equal(account.headers.get('x-ssr-mode'), 'per-request');
  assert.ok((await account.text()).includes('<app-account'));
  assert.ok(!(await state()).snapshots.some((s) => s.path === '/account'), 'account is never snapshotted');

  const signedIn = await fetch(`${BASE}/`, { headers: { cookie: 'session=Ada' } });
  assert.equal(signedIn.headers.get('x-ssr-mode'), 'per-request');
  const signedInHtml = await signedIn.text();
  assert.ok(signedInHtml.includes('Hi, Ada'), 'server-rendered greeting for signed-in visitors');

  const visitor = await fetch(`${BASE}/`, { headers: { cookie: 'visitor=Bob' } });
  assert.equal(visitor.headers.get('x-ssr-mode'), 'continuous');
  assert.ok(!(await visitor.text()).includes('Bob'), 'no personal data in a snapshot');
  const me = await (await fetch(`${BASE}/api/me`, { headers: { cookie: 'visitor=Bob' } })).json();
  assert.deepEqual(me, { name: 'Bob', signedIn: false });
});

test('honours Angular server routes: client-only, 404 wildcard, redirects, headers', async () => {
  const snapshots = (await state()).snapshots.map((s) => s.path);
  assert.ok(!snapshots.includes('/playground'), 'client-only route never snapshotted');
  assert.ok(!snapshots.includes('/legacy'), 'redirect never snapshotted');

  const playground = await fetch(`${BASE}/playground`);
  assert.equal(playground.headers.get('x-ssr-mode'), 'per-request');
  assert.ok(!(await playground.text()).includes('<app-playground'), 'client route ships no rendered component');

  const missing = await fetch(`${BASE}/nowhere`);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('x-ssr-mode'), 'per-request');
  assert.ok((await missing.text()).includes('<app-not-found'));

  const legacy = await fetch(`${BASE}/legacy`, { redirect: 'manual' });
  assert.ok([301, 302, 303, 307, 308].includes(legacy.status), `redirect status ${legacy.status}`);
  assert.match(legacy.headers.get('location'), /\/about$/);

  const about = await fetch(`${BASE}/about`);
  assert.equal(about.headers.get('x-ssr-mode'), 'continuous');
  assert.equal(about.headers.get('x-section'), 'about', 'server route header applied to the snapshot');
});

test('head tags set by a page travel with that page only', async () => {
  const article = await (await fetch(`${BASE}/news/1`)).text();
  assert.match(article, /<meta name="description" content="[^"]+">/);
  assert.match(article, /<meta property="og:title" content="Snapshot cache keeps serving">/);
  assert.ok(article.includes('<title>Article · Continuous SSR</title>'));

  for (const path of ['/', '/about', '/news']) {
    const html = await (await fetch(`${BASE}${path}`)).text();
    assert.ok(!html.includes('name="description"'), `${path} has no leaked description`);
    assert.ok(!html.includes('og:title'), `${path} has no leaked og:title`);
    assert.ok(!html.includes('<title>Article'), `${path} has its own title`);
  }
});

test('nested static routes are discovered and a webhook refreshes only the listed paths', async () => {
  const snapshots = (await state()).snapshots.map((s) => s.path);
  for (const path of ['/docs', '/docs/getting-started', '/docs/api']) {
    assert.ok(snapshots.includes(path), `${path} discovered`);
  }
  const api = await fetch(`${BASE}/docs/api`);
  assert.equal(api.headers.get('x-ssr-mode'), 'continuous');
  const html = await api.text();
  assert.ok(html.includes('<app-docs-layout') && html.includes('<app-docs-api'));
  assert.ok(html.includes('<title>API · Continuous SSR</title>'));

  const before = Number((await fetch(`${BASE}/news`)).headers.get('x-ssr-version'));
  const webhook = await fetch(`${BASE}/api/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: ['/news'] }),
  });
  assert.equal(webhook.status, 200);
  const health = await (await fetch(`${BASE}/healthz`)).json();
  assert.match(health.lastRun.reasons, /webhook/);
  assert.equal(health.lastRun.routes, 1);
  assert.ok(Number((await fetch(`${BASE}/news`)).headers.get('x-ssr-version')) > before);
});

test('deferred blocks and incremental hydration serialize from the live app', async () => {
  const response = await fetch(`${BASE}/stats`);
  const html = await response.text();

  assert.equal(response.headers.get('x-ssr-mode'), 'continuous');
  assert.ok(html.includes('<app-stats-chart'), 'hydrate-on-interaction block is server rendered');
  assert.ok(html.includes('jsaction='), 'interaction triggers are recorded for replay');
  assert.ok(html.includes('Details placeholder'), 'viewport block ships its placeholder');
  assert.ok(!html.includes('<app-stats-details'), 'viewport block content is not rendered');
  const stateKeys = Object.keys(transferState(html));
  assert.ok(stateKeys.includes('__nghDeferData__'), `defer hydration data present (${stateKeys})`);
  assert.equal(occurrences(html, 'id="ng-state"'), 1);

  // Still intact after the live app re-rendered it.
  const version = Number(response.headers.get('x-ssr-version'));
  const later = await waitFor(
    async () => {
      const again = await fetch(`${BASE}/stats`);
      return Number(again.headers.get('x-ssr-version')) > version ? await again.text() : null;
    },
    { label: 'a newer stats snapshot' },
  );
  assert.ok(later.includes('jsaction=') && later.includes('__nghDeferData__'));
  assert.equal(occurrences(later, 'id="ng-state"'), 1);
});
