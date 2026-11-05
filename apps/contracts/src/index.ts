// Shared by web, worker and front end. It also goes into the skail bundle, so it has only types, constants
// and pure functions: no Node I/O imports, which the skail build rejects.

export const CatalogLimits = {
  pageSize: 20,
  /** Wait between pages, the rate limit of the source API. */
  secondsBetweenPages: 2,
  /** Safety cap in case the source never reports the end. It also bounds the run history. */
  maxPages: 50,
  /** Size of the demo catalog (DummyJSON has 194 products), used only by the page. */
  expectedProducts: 194,
  expectedPages: Math.ceil(194 / 20),
} as const;

/** The checkbox on the page: the target catalog rejects the first writes of this page. */
export const SimulatedFailure = {
  page: 3,
  times: 2,
} as const;

export interface Product {
  id: number;
  title: string;
  category: string | null;
  price: number;
}

/** One page as served by the source API. Pages start at 1. */
export interface SourcePage {
  products: Product[];
  hasMore: boolean;
}

/** What ImportPage returns to the function. It goes into the run history, so it has no products. */
export interface ImportedPage {
  imported: number;
  hasMore: boolean;
}

/** A page written to the target catalog. Writing the same import and page again replaces it. */
export interface PageRecord {
  page: number;
  products: Product[];
  durationMs: number;
}

export type ImportStage = "Starting" | "Started" | "Completed" | "Failed";

export interface ImportResult {
  importId: string;
  pages: number;
  products: number;
}

/** What ReportStatus sends to the web app. */
export interface ImportEvent {
  importId: string;
  stage: ImportStage;
  detail: string | null;
}

/** One row of the page table. `products` and `durationMs` are null until a write succeeds. */
export interface PageSummary {
  page: number;
  products: number | null;
  durationMs: number | null;
  /** Writes the target catalog received for the page, failed ones included. */
  attempts: number;
}

export interface ImportState {
  importId: string;
  stage: ImportStage;
  simulateFailure: boolean;
  pages: PageSummary[];
  detail: string | null;
}

export function isTerminal(stage: ImportStage): boolean {
  return stage === "Completed" || stage === "Failed";
}

export function importedCount(state: Pick<ImportState, "pages">): number {
  return state.pages.reduce((sum, page) => sum + (page.products ?? 0), 0);
}

export function completedText(products: number, pages: number): string {
  return `${products} products in ${pages} ${pages === 1 ? "page" : "pages"}`;
}

export interface UiState {
  label: string;
  enabled: boolean;
}

/** The button works only when no import is in progress. */
export function buttonRules(state: Pick<ImportState, "stage"> | undefined): UiState {
  return !state || isTerminal(state.stage)
    ? { label: "Import catalog", enabled: true }
    : { label: "Importing…", enabled: false };
}

/** What `GET /api/imports/{id}` and the SSE stream return. */
export interface ImportView extends ImportState {
  imported: number;
  expectedProducts: number;
  expectedPages: number;
  ui: UiState;
}
