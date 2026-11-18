import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { desc } from "drizzle-orm";
import { UploadDropzone } from "@/components/documents/UploadDropzone";
import { getSessionUserFromHeaders } from "@/server/auth/session";
import { withUser } from "@/server/db/rls";
import { documents } from "@/server/db/schema";

export const metadata = { title: "Dashboard" };

/**
 * The real dashboard (Phase 2.6): server-rendered from RLS-scoped queries —
 * no HTTP roundtrip to our own API, because the session and `withUser` are
 * right here. Anonymous visitors are redirected; guests and registered
 * users share the same surface with different caps.
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
        createdAt: documents.createdAt,
      })
      .from(documents)
      .orderBy(desc(documents.createdAt))
      .limit(100),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {user.isAnonymous
            ? "Your guest workspace. Upload up to the guest limit — parsing and chat arrive in later phases."
            : "Your library. Parsing and chat arrive in later phases."}
        </p>
      </div>

      <UploadDropzone isGuest={user.isAnonymous} />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-ink-muted">
          Nothing here yet — add a PDF, a lecture sheet, or a contract to begin.
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between px-6 py-4">
              <div className="min-w-0">
                <p className="truncate font-medium">{doc.name}</p>
                <p className="mt-0.5 font-mono text-xs text-ink-muted">
                  {doc.kind} · {doc.status} · {doc.createdAt.toISOString().slice(0, 10)}
                </p>
              </div>
              <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-xs text-ink-muted">
                {doc.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
