import { useCallback, useEffect, useState } from "react";
import { buttonRules, isTerminal, type ImportView } from "@skail-catalog-import/contracts";
import { getImport, startImport } from "./api";
import { ImportControls } from "./components/ImportControls";
import { PagesTable } from "./components/PagesTable";
import { ProgressBar } from "./components/ProgressBar";
import { StatusBadge } from "./components/StatusBadge";
import { savedPages, useCountdown } from "./hooks/useCountdown";
import { useImportStream } from "./hooks/useImportStream";

const KEY = "catalog-import.importId";

export function App() {
  const [state, setState] = useState<ImportView | undefined>();
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forget = useCallback(() => localStorage.removeItem(KEY), []);
  const active = state && !isTerminal(state.stage) ? state.importId : undefined;
  useImportStream(active, setState, forget);
  const secondsLeft = useCountdown(state);

  // reload keeps the controls right: the state always comes from the server
  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (!saved) return;
    getImport(saved).then((restored) => {
      if (!restored) return forget();
      setState(restored);
      setSimulateFailure(restored.simulateFailure);
      if (isTerminal(restored.stage)) forget();
    }, forget);
  }, [forget]);

  async function onImport() {
    setBusy(true);
    setError(null);
    try {
      const started = await startImport(simulateFailure);
      localStorage.setItem(KEY, started.importId);
      setState(started);
    } catch (e) {
      setError(`Could not start: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const saved = savedPages(state);
  const expectedPages = state?.expectedPages ?? 10;
  const failed = state?.stage === "Failed";

  return (
    <main>
      <header>
        <h1>Catalog import</h1>
        <p className="subtitle">
          A skail function imports 194 products from an external API, 20 per page, and waits 2 seconds between pages.
          Stop the worker in the middle and the import continues at the page where it stopped.
        </p>
      </header>

      <ImportControls
        ui={buttonRules(state)}
        busy={busy}
        simulateFailure={simulateFailure}
        onSimulateFailure={setSimulateFailure}
        onImport={onImport}
      />

      <section className="status">
        <StatusBadge stage={state?.stage} savedPages={saved} expectedPages={expectedPages} secondsLeft={secondsLeft} />
        {state && <span>{`${saved}/${expectedPages} pages`}</span>}
      </section>

      <ProgressBar imported={state?.imported ?? 0} expected={state?.expectedProducts ?? 194} />

      {error && <p className="error">{error}</p>}
      {state?.detail && <p className={failed ? "error" : "detail"}>{state.detail}</p>}

      {state && state.pages.length > 0 && <PagesTable pages={state.pages} />}

      <footer>
        Import <code>{state?.importId ?? "-"}</code>
      </footer>
    </main>
  );
}
