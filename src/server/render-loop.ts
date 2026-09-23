import { SnapshotStore, etagFor } from './snapshot-store';

export interface RouteRenderer {
  render(url: string): Promise<string>;
}

export interface RenderLoopOptions {
  readonly renderer: RouteRenderer;
  readonly store: SnapshotStore;
  /** Pathnames to keep snapshots for. */
  readonly routes: readonly string[];
  /** Runs on every rendered document, e.g. to inline critical CSS. */
  readonly postProcess?: (html: string, path: string) => Promise<string> | string;
  readonly now?: () => string;
  readonly onError?: (error: unknown, path: string) => void;
}

/**
 * Re-renders every configured route into the snapshot store.
 *
 * `refresh()` calls that arrive while a run is in progress are coalesced into a single
 * follow-up run, so a burst of state changes costs at most two full passes.
 */
export class RenderLoop {
  private version = 0;
  private running: Promise<void> | null = null;
  private dirty = false;

  constructor(private readonly options: RenderLoopOptions) {}

  /** Version of the most recently completed run. */
  get currentVersion(): number {
    return this.version;
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  /**
   * Renders all routes. Resolves once a run that started after this call has finished,
   * so the store reflects any state change made before calling it.
   */
  refresh(): Promise<void> {
    if (this.running) {
      this.dirty = true;
      return this.running;
    }
    this.running = this.runUntilClean().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runUntilClean(): Promise<void> {
    do {
      this.dirty = false;
      await this.renderAll();
    } while (this.dirty);
  }

  private async renderAll(): Promise<void> {
    const { renderer, store, routes, postProcess, now, onError } = this.options;
    const version = this.version + 1;

    for (const path of routes) {
      try {
        const rendered = await renderer.render(path);
        const html = postProcess ? await postProcess(rendered, path) : rendered;
        store.set({
          path,
          html,
          version,
          renderedAt: now ? now() : new Date().toISOString(),
          etag: etagFor(html),
        });
      } catch (error) {
        onError?.(error, path);
      }
    }

    this.version = version;
  }
}
