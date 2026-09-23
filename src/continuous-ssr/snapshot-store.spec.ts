import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSnapshotStore } from './file-snapshot-store';
import {
  KeyValueSnapshotStore,
  MemoryKeyValueClient,
  MemorySnapshotStore,
  Snapshot,
  SnapshotStore,
  etagFor,
} from './snapshot-store';

function snapshot(path: string, version = 1): Snapshot {
  const html = `<html>${path}@${version}</html>`;
  return { path, html, version, renderedAt: '2026-09-23T10:00:00.000Z', etag: etagFor(html) };
}

function behavesLikeASnapshotStore(name: string, create: () => Promise<SnapshotStore>) {
  describe(name, () => {
    let store: SnapshotStore;

    beforeEach(async () => {
      store = await create();
    });

    it('stores, replaces, lists and deletes snapshots by path', async () => {
      await store.set(snapshot('/', 1));
      await store.set(snapshot('/about', 1));
      await store.set(snapshot('/', 2));

      expect(await store.get('/')).toEqual(snapshot('/', 2));
      expect((await store.summaries()).map((s) => `${s.path}@${s.version}`).sort()).toEqual([
        '/@2',
        '/about@1',
      ]);
      expect(await store.get('/missing')).toBeUndefined();

      await store.delete('/about');
      expect(await store.get('/about')).toBeUndefined();
      expect(await store.summaries()).toHaveLength(1);
    });
  });
}

behavesLikeASnapshotStore('MemorySnapshotStore', async () => new MemorySnapshotStore());
behavesLikeASnapshotStore(
  'KeyValueSnapshotStore',
  async () => new KeyValueSnapshotStore(new MemoryKeyValueClient(), 'test:'),
);

describe('FileSnapshotStore', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'continuous-ssr-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  behavesLikeASnapshotStore('as a store', async () => new FileSnapshotStore(directory));

  it('writes the bare HTML next to the record for static serving', async () => {
    const store = new FileSnapshotStore(join(directory, 'nested'));
    await store.set(snapshot('/news/1'));

    expect(await readFile(join(directory, 'nested', 'news_1.html'), 'utf8')).toBe('<html>/news/1@1</html>');
    expect(await new FileSnapshotStore(join(directory, 'empty')).summaries()).toEqual([]);
  });
});

describe('etagFor', () => {
  it('is stable for equal input and different for different input', () => {
    expect(etagFor('abc')).toBe(etagFor('abc'));
    expect(etagFor('abc')).not.toBe(etagFor('abd'));
    expect(etagFor('abc')).toMatch(/^"[0-9a-f]{8}-[0-9a-f]+"$/);
  });
});
