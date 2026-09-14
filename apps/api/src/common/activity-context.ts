import { AsyncLocalStorage } from 'async_hooks';

/** Per-request audit state, set up for every HTTP request in main.ts. */
export interface ActivityContext {
  /** A handler already wrote its own (more specific) activity entry. */
  logged: boolean;
}

export const activityContext = new AsyncLocalStorage<ActivityContext>();
