import { randomUUID } from "node:crypto";
import type { ImportResult, Product } from "./model.js";
import type { SkailApiClient } from "./skail-api.js";

/** The target catalog did not accept the write: the app answers 503, and the command throws. */
export class TargetRejected extends Error {}

const REJECTED_PAGE = 3;
const REJECTED_TIMES = 2;

interface PageRow {
  attempts: number;
  rejected: boolean;
  products: Product[];
}

interface Import {
  id: string;
  rejectPage3: boolean;
  pages: Map<number, PageRow>;
  result: ImportResult | null;
}

/**
 * Starts the imports for the page and plays the target catalog: it keeps the products of each page in memory, and
 * writing the same page again replaces it. With the checkbox on, it rejects the first two writes of page 3. An import
 * the app does not know (it was started before the app restarted) shows up with its next page.
 */
export class ImportDesk {
  private readonly imports = new Map<string, Import>();
  private current: Import | null = null;

  constructor(private readonly skail: SkailApiClient) {}

  /** Starts an import, unless one is still running. */
  async start(rejectPage3: boolean): Promise<boolean> {
    if (this.current && !this.current.result) return false;

    const importId = randomUUID();
    this.current = this.create(importId, rejectPage3);
    try {
      await this.skail.trigger(importId);
    } catch (error) {
      this.imports.delete(importId); // the run did not start: the button works again
      this.current = null;
      throw error;
    }
    print(importId, rejectPage3 ? "import started; the target will reject page 3 twice" : "import started");
    return true;
  }

  /** The target catalog: the import id and the page number are the key, so a second write replaces the page. */
  savePage(importId: string, page: number, products: Product[]): void {
    const target = this.find(importId);
    const row = target.pages.get(page) ?? { attempts: 0, rejected: false, products: [] };
    target.pages.set(page, row);
    row.attempts++;
    row.rejected = target.rejectPage3 && page === REJECTED_PAGE && row.attempts <= REJECTED_TIMES;
    if (row.rejected) {
      print(importId, `page ${page}: rejected by the target (attempt ${row.attempts}), skail will try again`);
      throw new TargetRejected(`the target catalog rejected the write of page ${page} (503)`);
    }
    row.products = products;
    print(importId, `page ${page}: ${products.length} products written`);
  }

  completed(result: ImportResult): void {
    this.find(result.importId).result = result;
    print(result.importId, `import completed: ${result.products} products in ${result.pages} pages`);
  }

  /** What the page shows: the latest import. */
  view() {
    const i = this.current;
    if (!i) return null;
    const pages = [...i.pages].sort(([a], [b]) => a - b);
    return {
      id: i.id,
      rejectPage3: i.rejectPage3,
      result: i.result,
      products: pages.reduce((sum, [, row]) => sum + row.products.length, 0),
      pages: pages
        .map(([page, row]) => ({
          page,
          attempts: row.attempts,
          products: row.products.length,
          status: row.rejected ? "rejected" : row.products.length > 0 ? "written" : "writing",
          sample: row.products.slice(0, 3).map((p) => p.title),
        }))
        .reverse(),
    };
  }

  // an import started before the app restarted: the page follows it from its next page
  private find(importId: string): Import {
    return this.imports.get(importId) ?? (this.current = this.create(importId, false));
  }

  private create(importId: string, rejectPage3: boolean): Import {
    const created = { id: importId, rejectPage3, pages: new Map(), result: null };
    this.imports.set(importId, created);
    return created;
  }
}

/** Each line starts with the first 8 characters of the import id. */
function print(importId: string, message: string): void {
  console.log(`[${importId.slice(0, 8)}] ${message}`);
}
