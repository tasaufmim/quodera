import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { desc } from "drizzle-orm";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";
import { getSessionUserFromHeaders } from "@/server/auth/session";
import { withUser } from "@/server/db/rls";
import { threads } from "@/server/db/schema";

export const metadata = { title: "Chat" };

/**
 * The chat surface: server-rendered thread list (RLS-scoped via withUser),
 * client-side streaming with live [n] markers, citations clickable to the
 * evidence panel. Anonymous → /sign-in, like every (app) page.
 */
export default async function ChatPage() {
  const user = await getSessionUserFromHeaders(await headers());
  if (!user) {
    redirect("/sign-in");
  }

  const rows = await withUser(user.id, (tx) =>
    tx
      .select({ id: threads.id, title: threads.title })
      .from(threads)
      .orderBy(desc(threads.updatedAt))
      .limit(100),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Ask anything about your library — every claim arrives with clickable references to page,
          paragraph, and line.
        </p>
      </div>
      <ChatWorkspace initialThreads={rows} />
    </div>
  );
}
