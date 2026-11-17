import Link from "next/link";

const PIPELINE = [
  {
    step: "01",
    title: "Upload",
    detail: "PDFs, images, text files, and documents flow into your private library.",
  },
  {
    step: "02",
    title: "Parse & chunk",
    detail:
      "Layout-aware OCR and converters stamp page / paragraph / line provenance onto every chunk.",
  },
  {
    step: "03",
    title: "Retrieve",
    detail: "Hybrid BM25 + vector search over your library, then rerank the best spans.",
  },
  {
    step: "04",
    title: "Answer",
    detail: "The model may only answer from retrieved spans — and must cite each one.",
  },
] as const;

export default function LandingPage() {
  return (
    <main>
      <section className="mx-auto max-w-5xl px-6 py-24 text-center sm:py-32">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
          citation-grounded rag
        </p>
        <h1 className="mt-6 text-5xl font-semibold tracking-tight sm:text-6xl">
          Answers, <span className="text-primary">demonstrated</span>
          <sup className="ml-1 align-super font-mono text-xl font-bold text-primary sm:text-2xl">
            [1]
          </sup>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink-muted">
          Quodera turns your documents — lecture sheets, legal contracts, book chapters, official
          docs — into a knowledge base the chatbot must cite: document, page, paragraph, and line
          for every sentence it writes.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/dashboard"
            className="rounded-lg bg-primary px-5 py-3 font-medium text-primary-ink transition hover:opacity-90"
          >
            Open the app
          </Link>
          <Link
            href="/api/health"
            className="rounded-lg border border-line px-5 py-3 font-mono text-sm transition hover:border-primary"
          >
            GET /api/health
          </Link>
        </div>
        <p className="mt-8 font-mono text-xs text-ink-muted">
          phase 1 · foundation — auth, ingest &amp; retrieval arrive in phases 2–4
        </p>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-px px-6 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE.map((item) => (
            <div key={item.step} className="py-10 lg:px-6">
              <p className="font-mono text-xs text-primary">{item.step}</p>
              <h2 className="mt-2 font-medium">{item.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
