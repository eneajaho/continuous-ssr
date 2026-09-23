import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { config } from './app/app.config.server';

const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, config, context);

export default bootstrap;

/**
 * The server entry loads this bundle at runtime and starts the engine from it, so the engine
 * shares this bundle's copy of Angular with the per-request renderer.
 */
export * from './continuous-ssr/server';
/** Demo only: lets the API endpoints in `server.ts` mutate the live state. */
export { Announcements } from './app/announcements';
export { LiveDataStore } from './app/live-data.store';
