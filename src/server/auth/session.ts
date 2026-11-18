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

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  const user = session?.user;
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAnonymous: Boolean(user.isAnonymous),
  };
}
