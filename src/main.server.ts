import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { config } from './app/app.config.server';

const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, config, context);

export default bootstrap;

/**
 * Re-exported so the server entry can reach them through the built `main.server.mjs`,
 * sharing one copy of Angular with the per-request engine instead of bundling a second one.
 */
export { LiveDataStore } from './app/live-data.store';
export { ContinuousRenderer } from './server/continuous-renderer';
