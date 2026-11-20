import { describe, expect, it } from "vitest";
import { streamOpenRouter } from "./openrouter";

/**
 * The OpenRouter SSE parser against a mocked stream — no network. Pins the
 * wire contract: "data:" frames, token deltas, usage in a final frame,
 * "[DONE]" termination, and resilience to a JSON frame split across two
 * network chunks.
 */

function sseResponse(frames: string[], init?: { status: number; body?: string }): Response {
  const encoder = new TextEncoder();
  const body = init?.body ?? frames.map((frame) => `data: ${frame}\n\n`).join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: init?.status ?? 200 });
}

async function collect(generator: AsyncGenerator<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe("streamOpenRouter", () => {
  it("yields tokens, then usage, then ends at [DONE]", async () => {
    const events = await collect(
      streamOpenRouter({
        apiKey: "test",
        model: "openrouter/free",
        messages: [{ role: "user", content: "q" }],
        fetchImpl: async () =>
          sseResponse([
            JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }),
            JSON.stringify({ choices: [{ delta: { content: " world" } }] }),
            JSON.stringify({ usage: { prompt_tokens: 12, completion_tokens: 2 } }),
            "[DONE]",
          ]),
      }),
    );

    expect(events).toEqual([
      { type: "token", text: "Hello" },
      { type: "token", text: " world" },
      { type: "usage", tokensIn: 12, tokensOut: 2 },
    ]);
  });

  it("survives a JSON frame split across two network chunks", async () => {
    const encoder = new TextEncoder();
    const frame = JSON.stringify({ choices: [{ delta: { content: "split" } }] });
    const body = `data: ${frame.slice(0, 20)}`;
    const rest = `${frame.slice(20)}\n\ndata: [DONE]\n\n`;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(body));
        // let the parser buffer the partial line first
        await new Promise((resolve) => setTimeout(resolve, 10));
        controller.enqueue(encoder.encode(rest));
        controller.close();
      },
    });

    const events = await collect(
      streamOpenRouter({
        apiKey: "test",
        model: "openrouter/free",
        messages: [{ role: "user", content: "q" }],
        fetchImpl: async () => new Response(stream, { status: 200 }),
      }),
    );

    expect(events).toContainEqual({ type: "token", text: "split" });
  });

  it("skips empty deltas and non-data lines", async () => {
    const encoder = new TextEncoder();
    const body = [
      ": keep-alive comment",
      "data: " + JSON.stringify({ choices: [{ delta: {} }] }),
      "",
      "data: " + JSON.stringify({ choices: [{ delta: { content: "ok" } }] }),
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const events = await collect(
      streamOpenRouter({
        apiKey: "test",
        model: "openrouter/free",
        messages: [{ role: "user", content: "q" }],
        fetchImpl: async () => new Response(encoder.encode(body), { status: 200 }),
      }),
    );

    expect(events).toEqual([{ type: "token", text: "ok" }]);
  });

  it("throws with status detail on a non-OK response", async () => {
    await expect(
      collect(
        streamOpenRouter({
          apiKey: "test",
          model: "nope",
          messages: [{ role: "user", content: "q" }],
          fetchImpl: async () =>
            new Response("no credits", { status: 402, headers: { "content-type": "text/plain" } }),
        }),
      ),
    ).rejects.toThrow(/402/);
  });
});
