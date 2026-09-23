/**
 * Continuous server-side rendering for Angular: one live application, snapshots per route,
 * automatic re-rendering on change. See README.md for how it fits together.
 */
export { provideContinuousRendering, type ContinuousRenderingOptions } from './config';
export { ContinuousAppEngine, type ContinuousAppEngineOptions } from './engine';
export { createLogger, isLogLevel, kb, ms, type LogLevel, type Logger } from './log';
export { makeSharedStateKey, sharedState } from './shared-state';
