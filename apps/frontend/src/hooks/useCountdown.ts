import { useEffect, useState } from "react";
import { CatalogLimits, type ImportView } from "@skail-catalog-import/contracts";

/** Pages the target catalog already accepted. */
export const savedPages = (state: ImportView | undefined): number =>
  state?.pages.filter((p) => p.products !== null).length ?? 0;

/**
 * Visual hint of the 2-second wait between pages: it restarts each time a page is saved and runs only while the
 * import is in progress. Returns the seconds left, or null when not waiting.
 */
export function useCountdown(state: ImportView | undefined): number | null {
  const saved = savedPages(state);
  const waiting = state?.stage === "Started" && saved > 0;
  const [secondsLeft, setSecondsLeft] = useState<number>(CatalogLimits.secondsBetweenPages);

  useEffect(() => {
    if (!waiting) return;
    setSecondsLeft(CatalogLimits.secondsBetweenPages);
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [waiting, saved]);

  return waiting ? secondsLeft : null;
}
