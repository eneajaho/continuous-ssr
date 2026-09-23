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
