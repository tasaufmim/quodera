"use client";

/**
 * global-error replaces the ROOT layout when it triggers, so it must render
 * its own <html>/<body> and cannot rely on globals.css — hence inline styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ backgroundColor: "#09090f", color: "#ededf2", margin: 0 }}>
        <main
          style={{
            display: "flex",
            minHeight: "100dvh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 32,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Application error</h1>
          <p style={{ color: "#8e8ea0", maxWidth: 420, textAlign: "center", fontSize: 14 }}>
            A critical error broke the page shell. It has been logged. Quote the digest if you
            report this.
          </p>
          {error.digest ? (
            <code
              style={{ background: "#171722", padding: "4px 8px", borderRadius: 4, fontSize: 12 }}
            >
              {error.digest}
            </code>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 8,
              border: "1px solid #26262f",
              background: "transparent",
              color: "inherit",
              padding: "8px 16px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
