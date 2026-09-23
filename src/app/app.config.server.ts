import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideContinuousRendering } from '../continuous-ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // Snapshots for every static route, re-rendered whenever the live app changes.
    provideContinuousRendering({
      // Safety net for changes the app cannot see, and a bound on what a long life accumulates.
      refreshIntervalMs: 60_000,
      recycle: { afterRenders: 5_000, afterMs: 60 * 60_000, maxHeapMb: 512 },
    }),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
