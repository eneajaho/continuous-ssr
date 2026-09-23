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

/** In-memory snapshot cache keyed by pathname. */
export class SnapshotStore {
  private readonly snapshots = new Map<string, Snapshot>();

  get(path: string): Snapshot | undefined {
    return this.snapshots.get(path);
  }

  set(snapshot: Snapshot): void {
    this.snapshots.set(snapshot.path, snapshot);
  }

  get size(): number {
    return this.snapshots.size;
  }

  summaries(): SnapshotSummary[] {
    return Array.from(this.snapshots.values(), ({ html: _html, ...summary }) => summary);
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
