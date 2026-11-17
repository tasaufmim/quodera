const PLACEHOLDER_STATS = [
  { label: "Documents", value: "0" },
  { label: "Threads", value: "0" },
  { label: "Citations", value: "0" },
] as const;

const PHASE_2_PREVIEW = [
  "better-auth: Google + GitHub OAuth and email magic links",
  "Real schema — documents, chunks, threads, messages — every table RLS-guarded like tenancy_canary",
  "Per-route rate-limit policy matrix on Upstash Redis",
  "Hardened uploads: magic-byte validation, size caps, decompression-bomb guards",
] as const;

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Placeholder — your document library and chat threads land here in Phase 2+.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {PLACEHOLDER_STATS.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-line bg-surface p-6">
            <p className="font-mono text-3xl font-semibold">{stat.value}</p>
            <p className="mt-1 text-sm text-ink-muted">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-surface p-6">
        <h2 className="font-medium">Phase 2 preview</h2>
        <ul className="mt-3 space-y-2">
          {PHASE_2_PREVIEW.map((item) => (
            <li key={item} className="flex gap-3 text-sm leading-relaxed text-ink-muted">
              <span aria-hidden className="font-mono text-primary">
                ›
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
