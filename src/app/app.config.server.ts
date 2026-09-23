import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideContinuousRendering } from '../continuous-ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // Snapshots for every static route, re-rendered whenever the live app changes.
    provideContinuousRendering(),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
