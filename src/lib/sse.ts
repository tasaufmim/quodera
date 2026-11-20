/**
 * Client-side SSE reader for POST streams (EventSource is GET-only, so the
 * browser reads our fetch response body by hand). Mirrors the wire protocol
 * from src/server/chat/protocol.ts: named events, one JSON payload each.
 */
export type SseEventHandler = (name: string, data: Record<string, unknown>) => void;

export async function readSse(response: Response, onEvent: SseEventHandler): Promise<void> {
  if (!response.body) {
    throw new Error("SSE response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      if (!eventLine || !dataLine) continue;

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
      } catch {
        continue; // malformed frame — skip rather than kill the stream
      }
      onEvent(eventLine.slice(6).trim(), data);
    }
  }
}
