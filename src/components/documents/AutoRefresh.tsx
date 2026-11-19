"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Poll-refresh while any document is queued/parsing: ingest completes in
 * seconds, and the list re-renders server-side via router.refresh(). Stops
 * itself when nothing is pending — no idle polling.
 */
export function AutoRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(interval);
  }, [enabled, router]);

  return null;
}
