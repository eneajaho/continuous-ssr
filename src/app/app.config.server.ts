import { HttpClient } from '@angular/common/http';
import { ApplicationConfig, inject, mergeApplicationConfig } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideContinuousRendering } from '../continuous-ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { NewsFeed } from './pages/news';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // Snapshots for every static route, re-rendered whenever the live app changes.
    provideContinuousRendering({
      // Static routes are discovered; parameterised ones list their instances, here from the
      // news API through the live app's own HttpClient.
      routes: [
        {
          path: 'news/:id',
          params: async () => {
            const feed = await firstValueFrom(inject(HttpClient).get<NewsFeed>('/api/news'));
            return feed.items.map((item) => ({ id: String(item.id) }));
          },
        },
      ],
      // Safety net for changes the app cannot see, and a bound on what a long life accumulates.
      refreshIntervalMs: 60_000,
      recycle: { afterRenders: 5_000, afterMs: 60 * 60_000, maxHeapMb: 512 },
    }),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
