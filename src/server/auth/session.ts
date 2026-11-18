import { cache } from "react";
import { getAuth } from "./index";

/**
 * The three-state session view (ARCHITECTURE §5) as one structural type —
 * route handlers gate on this, never on client state:
 *   null → anonymous · isAnonymous=true → guest · else → registered
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isAnonymous: boolean;
}

/**
 * Session lookup from a Headers instance — the server-component path
 * (`headers()` from next/headers) and the route-handler path share it.
 * `cache()` dedupes the lookup across a single render pass (layout + page
 * both ask; the DB answers once).
 */
export const getSessionUserFromHeaders = cache(
  async (headers: Headers): Promise<SessionUser | null> => {
    const session = await getAuth().api.getSession({ headers });
    const user = session?.user;
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isAnonymous: Boolean(user.isAnonymous),
    };
  },
);

/** Route-handler convenience — extracts headers from the Request. */
export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  return getSessionUserFromHeaders(request.headers);
}
