import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context propagated through the call graph without threading
 * arguments. `withApi` (api-handler.ts) is the only place that should call
 * runWithContext; anything deeper uses getRequestContext().
 *
 * NOTE: this is Node-runtime only — edge middleware runs in a separate
 * runtime and cannot see these values (see ARCHITECTURE.md §runtimes).
 */
export interface RequestContext {
  requestId: string;
  route: string;
  startedAt: number;
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return als.run(context, fn);
}

/** Partial because code may run outside a request (scripts, workers). */
export function getRequestContext(): Partial<RequestContext> {
  return als.getStore() ?? {};
}
