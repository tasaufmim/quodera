# ADR 0005: Layout-aware OCR in a serverless worker (docTR/PaddleOCR on Render)

- **Status:** accepted
- **Date:** 2026-11-17

## Context

Scanned PDFs and images carry no text layer. The naive approach (Tesseract words, or shipping images to a vision LLM) fails the product's core requirement in two ways: without **line and paragraph bounding boxes** there are no page/paragraph/line citations, and vision-LLM passes on every page cost more than the whole free-tier budget. OCR is also CPU-heavy — Vercel Hobby function timeouts make in-request OCR a non-starter.

## Decision

OCR runs in a **dedicated Python worker** (Render free tier) behind a job queue. The worker uses a **layout-aware** engine (docTR primary; PaddleOCR's PP-Structure as the fallback for table-heavy pages) and returns a **provenance tree** — pages → paragraphs → line boxes — which the chunker consumes to mint citations. The same worker also runs markitdown for DOCX/PPTX/XLSX/HTML (one Python process, three jobs: convert, OCR, and later RAGAS evals in CI).

## Consequences

- Citations from scans are as precise as from digital PDFs (page/¶/line from actual layout geometry).
- Token economics work: the model never sees images; only retrieved chunk text enters the context.
- Render free tier = cold starts; the upload flow is async (`queued → parsing → ready`) with status polling, which is the honest UX for big documents anyway.
- Python is a second runtime to maintain — contained in `worker/`, wired via HTTP + queue, versioned with its own requirements and CI job.

## Alternatives considered

| Alternative                 | Why not                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Tesseract.js in-browser     | free and private, but no reliable line/paragraph structure → weak citations; struggles with multi-column and tables |
| Vision-LLM per page         | cost scales with pages; line-level precision from VLMs is inconsistent                                              |
| OCR inside Vercel functions | CPU + timeout limits on Hobby make 20-page scans fail mid-flight                                                    |

## Amendment (2026-11-18 — parser placement, decided before Phase 3)

The original sketch put ALL parsing in the worker. The facts on the ground
differ: text-layer PDF extraction is fast Node work — `pdfjs-dist` yields
text with coordinates in seconds even for hundreds of pages, because it
parses content streams rather than rendering pixels — and a DOCX is a zip
whose `word/document.xml` walks to paragraphs in ~40 lines. So:

- **Phase 3 parses text-layer formats IN NODE**, inside a Vercel route via
  Next's `after()` (async, post-response): pdfjs-dist for PDFs, the XML
  walker for DOCX, plain splitting for TXT/MD.
- **The worker's mandate narrows to what Node cannot do**: layout-aware OCR
  (docTR/PaddleOCR) for scanned pages and images, in Phase 5.
- **No duplicated parsers ever**: Node owns text-layer extraction
  permanently; the worker owns pixel formats. markitdown is no longer
  planned for OOXML — if PPTX/XLSX support ships later, it is Node-side
  zip+XML walking like DOCX.

This keeps the second runtime exactly as deferred as the roadmap promised,
spending its cost only when OCR genuinely requires it.
