/**
 * The OpenRouter streaming client (ADR 0007 — server proxy ONLY).
 * OpenAI-compatible chat/completions with stream: true; tokens are yielded
 * as they arrive, usage lands in the final data chunk (stream_options).
 * Injectable fetch for hermetic unit tests.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type LlmStreamEvent =
  { type: "token"; text: string } | { type: "usage"; tokensIn: number; tokensOut: number };

export interface StreamOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  fetchImpl?: typeof fetch;
}

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function* streamOpenRouter(options: StreamOptions): AsyncGenerator<LlmStreamEvent> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
      // OpenRouter attributes and ranks apps by these (their docs ask for it)
      "http-referer": process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
      "x-title": "Quodera",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`openrouter ${response.status} ${detail.slice(0, 300)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by blank lines; each data line begins "data: "
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;

        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const text = chunk.choices?.[0]?.delta?.content;
          if (typeof text === "string" && text.length > 0) {
            yield { type: "token", text };
          }
          if (chunk.usage) {
            yield {
              type: "usage",
              tokensIn: chunk.usage.prompt_tokens ?? 0,
              tokensOut: chunk.usage.completion_tokens ?? 0,
            };
          }
        } catch {
          // a partial JSON line split across network chunks — the next read
          // completes it; skip malformed frames rather than killing the stream
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
