export interface Snapshot {
  /** Pathname the snapshot was rendered for, e.g. `/about`. */
  readonly path: string;
  readonly html: string;
  /** Render-loop run that produced it. Monotonic across the process. */
  readonly version: number;
  /** ISO timestamp. */
  readonly renderedAt: string;
  /** Strong ETag derived from the HTML, for conditional requests. */
  readonly etag: string;
}

export type SnapshotSummary = Omit<Snapshot, 'html'>;

/**
 * Where snapshots live. The engine ships an in-memory store, a key/value store for Redis and
 * friends, and a file store; implement this to plug in anything else.
 */
export interface SnapshotStore {
  get(path: string): Promise<Snapshot | undefined>;
  set(snapshot: Snapshot): Promise<void>;
  delete(path: string): Promise<void>;
  summaries(): Promise<SnapshotSummary[]>;
}

/** Snapshots in a `Map`; the default, for a single process. */
export class MemorySnapshotStore implements SnapshotStore {
  private readonly snapshots = new Map<string, Snapshot>();

  async get(path: string): Promise<Snapshot | undefined> {
    return this.snapshots.get(path);
  }

  async set(snapshot: Snapshot): Promise<void> {
    this.snapshots.set(snapshot.path, snapshot);
  }

  async delete(path: string): Promise<void> {
    this.snapshots.delete(path);
  }

  async summaries(): Promise<SnapshotSummary[]> {
    return Array.from(this.snapshots.values(), ({ html: _html, ...summary }) => summary);
  }
}

/**
 * The few operations a key/value backend must offer. Redis (`ioredis`, `node-redis`),
 * Memcached, Cloudflare KV and similar clients wrap into this in a handful of lines.
 */
export interface KeyValueClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Every key that starts with `prefix`. */
  keys(prefix: string): Promise<string[]>;
}

/**
 * Snapshots in a shared key/value backend, so several server instances serve the same
 * snapshots and one renderer refreshes them for all.
 */
export class KeyValueSnapshotStore implements SnapshotStore {
  constructor(
    private readonly client: KeyValueClient,
    private readonly prefix = 'continuous-ssr:',
  ) {}

  async get(path: string): Promise<Snapshot | undefined> {
    const raw = await this.client.get(this.key(path));
    return raw === null ? undefined : (JSON.parse(raw) as Snapshot);
  }

  async set(snapshot: Snapshot): Promise<void> {
    await this.client.set(this.key(snapshot.path), JSON.stringify(snapshot));
  }

  async delete(path: string): Promise<void> {
    await this.client.delete(this.key(path));
  }

  async summaries(): Promise<SnapshotSummary[]> {
    const keys = await this.client.keys(this.prefix);
    const summaries: SnapshotSummary[] = [];
    for (const key of keys) {
      const raw = await this.client.get(key);
      if (raw !== null) {
        const { html: _html, ...summary } = JSON.parse(raw) as Snapshot;
        summaries.push(summary);
      }
    }
    return summaries;
  }

  private key(path: string): string {
    return `${this.prefix}${path}`;
  }
}

/** In-memory `KeyValueClient`, for tests and as a template for real adapters. */
export class MemoryKeyValueClient implements KeyValueClient {
  readonly entries = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async keys(prefix: string): Promise<string[]> {
    return Array.from(this.entries.keys()).filter((key) => key.startsWith(prefix));
  }
}

/** FNV-1a over the HTML, cheap and good enough for an ETag. */
export function etagFor(html: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < html.length; i++) {
    hash ^= html.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `"${(hash >>> 0).toString(16).padStart(8, '0')}-${html.length.toString(16)}"`;
}
