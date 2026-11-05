import type { UiState } from "@skail-catalog-import/contracts";

interface Props {
  ui: UiState;
  busy: boolean;
  simulateFailure: boolean;
  onSimulateFailure: (value: boolean) => void;
  onImport: () => void;
}

export function ImportControls({ ui, busy, simulateFailure, onSimulateFailure, onImport }: Props) {
  const disabled = !ui.enabled || busy;
  return (
    <section className="controls">
      <button id="import" type="button" disabled={disabled} onClick={onImport}>
        {ui.label}
      </button>
      <label>
        <input
          type="checkbox"
          checked={simulateFailure}
          disabled={disabled}
          onChange={(e) => onSimulateFailure(e.target.checked)}
        />
        Make the target catalog reject page 3 twice
      </label>
    </section>
  );
}
