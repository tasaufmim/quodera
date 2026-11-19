import { after } from "next/server";

/**
 * Post-response task scheduling, indirection for testability.
 *
 * The default scheduler is Next's after(): the task runs after the response
 * is sent — that's the ingest UX (upload resolves immediately, indexing
 * lands via the status flow). Outside a request scope — vitest calling
 * handlers directly — after() THROWS, so tests swap in an eager scheduler
 * before invoking routes. e2e exercises the real after() through the
 * actual server.
 */
export type AfterCallback = () => Promise<void>;

let scheduler: (callback: AfterCallback) => void = (callback) => {
  after(callback);
};

/** Swap the scheduler (tests). Returns the previous one. */
export function setAfterScheduler(
  next: (callback: AfterCallback) => void,
): (callback: AfterCallback) => void {
  const previous = scheduler;
  scheduler = next;
  return previous;
}

export function scheduleAfter(callback: AfterCallback): void {
  scheduler(callback);
}
