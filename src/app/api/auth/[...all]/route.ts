import { getAuth } from "@/server/auth";
import { withApi } from "@/server/lib/api-handler";

/**
 * better-auth catch-all: every /api/auth/* route (OAuth callbacks, magic
 * link send/verify, session, sign-out) is served by auth.handler, wrapped
 * in withApi for request ids, structured logging, and error capture
 * (GUARDRAILS #3). getAuth() is lazy — the module stays build-safe.
 */

async function handleAuth(request: Request): Promise<Response> {
  return getAuth().handler(request);
}

export const GET = withApi("auth", handleAuth);
export const POST = withApi("auth", handleAuth);
