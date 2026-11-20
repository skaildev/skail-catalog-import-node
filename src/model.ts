// Types and constants of the demo. This file ends up inside the skail bundle: pure code only, no Node imports.

export const CatalogLimits = {
  pageSize: 20,
  /** Wait between pages, the rate limit of the source API. */
  secondsBetweenPages: 2,
  /** Safety cap in case the source never reports the end. It also bounds the run history. */
  maxPages: 50,
} as const;

export interface Product {
  id: number;
  title: string;
  category: string | null;
  price: number;
}

/** One page as the source API serves it. Pages start at 1. */
export interface SourcePage {
  products: Product[];
  hasMore: boolean;
}

/** What ImportPage returns to the function. It goes into the run history, so it has no products. */
export interface ImportedPage {
  imported: number;
  hasMore: boolean;
}

export interface ImportResult {
  importId: string;
  pages: number;
  products: number;
}
