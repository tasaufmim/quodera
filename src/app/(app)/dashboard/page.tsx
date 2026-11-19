import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { desc } from "drizzle-orm";
import { AutoRefresh } from "@/components/documents/AutoRefresh";
import { UploadDropzone } from "@/components/documents/UploadDropzone";
import { getSessionUserFromHeaders } from "@/server/auth/session";
import { withUser } from "@/server/db/rls";
import { documents } from "@/server/db/schema";
import { errorCopy, statusCopy } from "@/lib/document-status";

export const metadata = { title: "Dashboard" };

/**
 * The real dashboard: server-rendered from RLS-scoped `withUser()` queries,
 * honest status for every document (queued → parsing → ready | failed with
 * reason), and a poll-refresh that only runs while work is pending.
 */
export default async function DashboardPage() {
  const user = await getSessionUserFromHeaders(await headers());
  if (!user) {
    redirect("/sign-in");
  }

  const rows = await withUser(user.id, (tx) =>
    tx
      .select({
        id: documents.id,
        name: documents.name,
        kind: documents.kind,
        status: documents.status,
        error: documents.error,
        pageCount: documents.pageCount,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .orderBy(desc(documents.createdAt))
      .limit(100),
  );

  const hasPending = rows.some((doc) => doc.status === "queued" || doc.status === "parsing");

  return (
    <div className="space-y-6">
      <AutoRefresh enabled={hasPending} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {user.isAnonymous
            ? "Your guest workspace. Documents index automatically after upload — chat arrives in Phase 4."
            : "Your library. Documents index automatically after upload — chat arrives in Phase 4."}
        </p>
      </div>

      <UploadDropzone isGuest={user.isAnonymous} />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-ink-muted">
          Nothing here yet — add a PDF, a lecture sheet, or a contract to begin.
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map((doc) => {
            const failed = doc.status === "failed";
            return (
              <li key={doc.id} className="px-6 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{doc.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-ink-muted">
                      {doc.kind}
                      {doc.pageCount !== null ? ` · ${doc.pageCount}p` : ""} ·{" "}
                      {doc.createdAt.toISOString().slice(0, 10)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-xs ${
                      failed
                        ? "border-red-900 text-red-300"
                        : doc.status === "ready"
                          ? "border-line text-ink"
                          : "border-line text-ink-muted"
                    }`}
                  >
                    {statusCopy(doc.status)}
                  </span>
                </div>
                {failed && doc.error ? (
                  <p className="mt-2 text-sm text-ink-muted">{errorCopy(doc.error)}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
