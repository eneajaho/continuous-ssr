import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Snapshot, SnapshotStore, SnapshotSummary } from './snapshot-store';

/**
 * Snapshots as files in a directory: one `<encoded path>.json` per route plus the bare HTML
 * next to it, so a static file server or CDN origin can serve the HTML directly and other
 * processes on the same machine can read the metadata.
 */
export class FileSnapshotStore implements SnapshotStore {
  constructor(private readonly directory: string) {}

  async get(path: string): Promise<Snapshot | undefined> {
    try {
      return JSON.parse(await readFile(this.file(path, 'json'), 'utf8')) as Snapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async set(snapshot: Snapshot): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    // Write the HTML for static serving and the full record for `get`; the record is written
    // last so a reader never sees metadata for HTML that is not there yet.
    await writeFile(this.file(snapshot.path, 'html'), snapshot.html, 'utf8');
    await writeFile(this.file(snapshot.path, 'json'), JSON.stringify(snapshot), 'utf8');
  }

  async delete(path: string): Promise<void> {
    await rm(this.file(path, 'json'), { force: true });
    await rm(this.file(path, 'html'), { force: true });
  }

  async summaries(): Promise<SnapshotSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      return [];
    }
    const summaries: SnapshotSummary[] = [];
    for (const name of names.filter((entry) => entry.endsWith('.json'))) {
      const { html: _html, ...summary } = JSON.parse(
        await readFile(join(this.directory, name), 'utf8'),
      ) as Snapshot;
      summaries.push(summary);
    }
    return summaries;
  }

  private file(path: string, extension: 'json' | 'html'): string {
    const name = path === '/' ? 'index' : path.replace(/^\//, '').replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(this.directory, `${name}.${extension}`);
  }
}
