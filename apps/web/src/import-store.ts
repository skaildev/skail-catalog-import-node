import {
  SimulatedFailure,
  isTerminal,
  type ImportEvent,
  type ImportStage,
  type ImportState,
  type PageRecord,
  type PageSummary,
  type Product,
} from "@skail-catalog-import/contracts";

interface Subscriber {
  onState: (state: ImportState) => void;
  onClose: () => void;
}

interface ImportData {
  state: ImportState;
  pages: Map<number, PageRecord>;
  attempts: Map<number, number>;
  seen: Set<ImportStage>;
  simulatedFailures: number;
}

export type SaveOutcome = "saved" | "rejected" | "unknown";

/**
 * The imports kept in memory, as the page shows them, and the products written to the target catalog. The run
 * itself, with its history, lives in skail.
 */
export class ImportStore {
  readonly #imports = new Map<string, ImportData>();
  readonly #subscribers = new Map<string, Set<Subscriber>>();

  get count(): number {
    return this.#imports.size;
  }

  create(importId: string, simulateFailure = false): ImportState {
    const state: ImportState = { importId, stage: "Starting", simulateFailure, pages: [], detail: null };
    this.#imports.set(importId, {
      state,
      pages: new Map(),
      attempts: new Map(),
      seen: new Set(),
      simulatedFailures: 0,
    });
    return state;
  }

  get(importId: string): ImportState | undefined {
    return this.#imports.get(importId)?.state;
  }

  remove(importId: string): void {
    this.#imports.delete(importId);
    this.#close(importId);
  }

  /** The products written so far. A page written twice replaces the first write, so there are no duplicates. */
  products(importId: string): Product[] {
    const data = this.#imports.get(importId);
    if (!data) return [];
    return [...data.pages.entries()].sort(([a], [b]) => a - b).flatMap(([, record]) => record.products);
  }

  /**
   * Writes a page. Every call counts as an attempt. With the simulated failure on, the first writes of
   * SimulatedFailure.page are rejected, and the caller answers 503.
   */
  savePage(importId: string, record: PageRecord): SaveOutcome {
    const data = this.#imports.get(importId);
    if (!data) return "unknown";

    data.attempts.set(record.page, (data.attempts.get(record.page) ?? 0) + 1);
    const reject =
      data.state.simulateFailure &&
      record.page === SimulatedFailure.page &&
      data.simulatedFailures < SimulatedFailure.times;
    if (reject) data.simulatedFailures++;
    else data.pages.set(record.page, record);

    const pages: PageSummary[] = [...data.attempts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([page, attempts]) => {
        const saved = data.pages.get(page);
        return { page, products: saved?.products.length ?? null, durationMs: saved?.durationMs ?? null, attempts };
      });
    const stage = data.state.stage === "Starting" ? "Started" : data.state.stage;
    this.#publish(importId, { ...data.state, stage, pages });
    return reject ? "rejected" : "saved";
  }

  /** @returns true when the event changed the import; false when ignored (unknown, finished or repeated stage). */
  apply(event: ImportEvent): boolean {
    const data = this.#imports.get(event.importId);
    if (!data || isTerminal(data.state.stage) || data.seen.has(event.stage)) return false;
    data.seen.add(event.stage);

    this.#publish(event.importId, { ...data.state, stage: event.stage, detail: event.detail ?? data.state.detail });
    return true;
  }

  /** @returns the unsubscribe function. `onClose` runs when the import ends or is removed. */
  subscribe(importId: string, onState: (state: ImportState) => void, onClose: () => void): () => void {
    const subscriber: Subscriber = { onState, onClose };
    let set = this.#subscribers.get(importId);
    if (!set) this.#subscribers.set(importId, (set = new Set()));
    set.add(subscriber);
    return () => void this.#subscribers.get(importId)?.delete(subscriber);
  }

  #publish(importId: string, state: ImportState): void {
    this.#imports.get(importId)!.state = state;
    for (const subscriber of [...(this.#subscribers.get(importId) ?? [])]) subscriber.onState(state);
    if (isTerminal(state.stage)) this.#close(importId);
  }

  #close(importId: string): void {
    const set = this.#subscribers.get(importId);
    if (!set) return;
    this.#subscribers.delete(importId);
    for (const subscriber of set) subscriber.onClose();
  }
}
