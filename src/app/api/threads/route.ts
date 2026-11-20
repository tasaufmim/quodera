import { desc } from "drizzle-orm";
import { withApi } from "@/server/lib/api-handler";
import { getSessionUser } from "@/server/auth/session";
import { withUser } from "@/server/db/rls";
import { threads } from "@/server/db/schema";

export const dynamic = "force-dynamic";

/** Thread list for the chat sidebar — RLS-scoped, newest first. */
export const GET = withApi("threads.list", async (request: Request) => {
  const session = await getSessionUser(request);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await withUser(session.id, (tx) =>
    tx
      .select({
        id: threads.id,
        title: threads.title,
        createdAt: threads.createdAt,
        updatedAt: threads.updatedAt,
      })
      .from(threads)
      .orderBy(desc(threads.updatedAt))
      .limit(100),
  );

  return Response.json({ threads: rows });
});
