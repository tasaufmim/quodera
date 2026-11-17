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
