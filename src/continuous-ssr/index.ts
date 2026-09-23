/**
 * Continuous server-side rendering for Angular: one live application, snapshots per route,
 * automatic re-rendering on change. This entry is safe to import from application code that
 * also runs in the browser; the engine itself is in `./server`.
 */
export { provideContinuousRendering, type ContinuousRenderingOptions } from './config';
export { makeSharedStateKey, sharedState, transferredState } from './shared-state';
