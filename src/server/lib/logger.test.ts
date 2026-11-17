import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { stream, parsed: () => lines.map((line) => JSON.parse(line)) };
}

/**
 * GUARDRAILS #8: secrets must never survive the log pipeline. These tests are
 * the enforcement — if a new field name leaks into logs, add it to the redact
 * list, not an exception to the test.
 */
describe("logger", () => {
  it("redacts known secret field names at the top level and nested", () => {
    const { stream, parsed } = capture();
    const log = createLogger(stream, "info");

    log
      .child({ apiKey: "sk-secret", route: "demo" })
      .info({ password: "hunter2", nested: { token: "tok" } }, "hello");

    const [entry] = parsed();
    expect(entry.apiKey).toBe("[redacted]");
    expect(entry.password).toBe("[redacted]");
    expect(entry.nested.token).toBe("[redacted]");
    expect(entry.route).toBe("demo");
  });

  it("redacts child-bound dsn/authorization values", () => {
    const { stream, parsed } = capture();
    const log = createLogger(stream, "info");

    log.child({ dsn: "https://key@sentry.example/1" }).info("ping");

    const [entry] = parsed();
    expect(entry.dsn).toBe("[redacted]");
  });
});
