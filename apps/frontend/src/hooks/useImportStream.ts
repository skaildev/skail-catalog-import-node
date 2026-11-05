import { useEffect } from "react";
import { isTerminal, type ImportView } from "@skail-catalog-import/contracts";

/**
 * Follows an import through SSE. EventSource reconnects by itself and the stream starts with the current
 * snapshot, so no update is lost. Closes when the import ends.
 */
export function useImportStream(
  importId: string | undefined,
  onState: (state: ImportView) => void,
  onTerminal: () => void,
) {
  useEffect(() => {
    if (!importId) return;
    const source = new EventSource(`/api/imports/${importId}/stream`);
    source.onmessage = (event) => {
      const state = JSON.parse(event.data) as ImportView;
      onState(state);
      if (isTerminal(state.stage)) {
        source.close();
        onTerminal();
      }
    };
    return () => source.close();
    // callbacks are stable (state setters); the stream only depends on the import id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importId]);
}
