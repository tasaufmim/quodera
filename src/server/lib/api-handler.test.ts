import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { withApi } from "./api-handler";
import { createLogger } from "./logger";
import { getRequestContext } from "./request-context";

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { logger: createLogger(stream, "info"), parsed: () => lines.map((l) => JSON.parse(l)) };
}

describe("withApi", () => {
  it("echoes a request id header and logs structured completion", async () => {
    const { logger, parsed } = captureLogger();
    const handler = withApi("test", async () => Response.json({ ok: true }), { logger });

    const response = await handler(new Request("http://localhost/test"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const completed = parsed().find((entry) => entry.msg === "request completed");
    expect(completed.route).toBe("test");
    expect(completed.status).toBe(200);
    expect(completed.requestId).toBe(response.headers.get("x-request-id"));
  });

  it("exposes request context to the handler via AsyncLocalStorage", async () => {
    const { logger } = captureLogger();
    const handler = withApi(
      "ctx",
      async () => {
        const ctx = getRequestContext();
        return Response.json({ requestId: ctx.requestId ?? null, route: ctx.route ?? null });
      },
      { logger },
    );

    const response = await handler(new Request("http://localhost/ctx"));
    const body = (await response.json()) as { requestId: string | null; route: string | null };

    expect(body.requestId).toBe(response.headers.get("x-request-id"));
    expect(body.route).toBe("ctx");
  });

  it("converts thrown errors into a 500 JSON with the request id — never rethrows", async () => {
    const { logger, parsed } = captureLogger();
    const handler = withApi(
      "boom",
      async () => {
        throw new Error("kaboom");
      },
      { logger },
    );

    const response = await handler(new Request("http://localhost/boom"));
    const body = (await response.json()) as { error: string; requestId: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe("internal_error");
    expect(body.requestId).toBe(response.headers.get("x-request-id"));

    const failed = parsed().find((entry) => entry.msg === "request failed");
    expect(failed.err.message).toBe("kaboom");
  });
});
