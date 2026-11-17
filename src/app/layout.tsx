import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Quodera — Answers, demonstrated.",
    template: "%s · Quodera",
  },
  description:
    "Citation-grounded RAG platform. Every sentence references its source: document, page, paragraph, and line.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
