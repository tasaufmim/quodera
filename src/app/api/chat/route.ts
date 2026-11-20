import { withApi } from "@/server/lib/api-handler";
import { handleChat } from "@/server/chat/orchestrate";

export const dynamic = "force-dynamic";

/**
 * POST /api/chat — the cited-chat SSE endpoint (ADR 0007/0011).
 * Session-gated; guests and registered demo users share the free-model pool
 * (5/day); BYO keys (x-openrouter-key header) bypass it with their own model
 * and an infra rate limit. Every answer path attaches citations
 * (GUARDRAILS #5) or refuses.
 */
export const POST = withApi("chat", (request: Request) => handleChat(request));
