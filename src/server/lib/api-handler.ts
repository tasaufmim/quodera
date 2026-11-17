import { randomUUID } from "node:crypto";
import { logger, type Logger } from "./logger";
import { captureException } from "./observability";
import { runWithContext } from "./request-context";

export type ApiHandler = (request: Request) => Promise<Response>;

interface WithApiOptions {
  /** Injectable for tests — defaults to the shared logger. */
  logger?: Logger;
}

/**
 * Wrap a route handler with the app's cross-cutting contract (GUARDRAILS #3):
 *
 *  - assigns a request id, echoed as `x-request-id` on every response
 *  - stores the request in AsyncLocalStorage (getRequestContext())
 *  - structured start/finish logging with duration, never containing secrets
 *  - catches every error → 500 JSON + Sentry, never an unhandled throw
 *
 * Usage: `export const GET = withApi("route-name", async (request) => …)`
 */
export function withApi(route: string, handler: ApiHandler, options?: WithApiOptions): ApiHandler {
  return async (request: Request) => {
    const requestId = randomUUID();
    const startedAt = Date.now();

    return runWithContext({ requestId, route, startedAt }, async () => {
      const requestLogger = (options?.logger ?? logger).child({
        requestId,
        route,
        method: request.method,
      });

      try {
        const response = await handler(request);
        response.headers.set("x-request-id", requestId);
        requestLogger.info(
          { status: response.status, durationMs: Date.now() - startedAt },
          "request completed",
        );
        return response;
      } catch (error) {
        captureException(error, { route, requestId });
        requestLogger.error({ err: serializeError(error) }, "request failed");
        const response = Response.json({ error: "internal_error", requestId }, { status: 500 });
        response.headers.set("x-request-id", requestId);
        return response;
      }
    });
  };
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
