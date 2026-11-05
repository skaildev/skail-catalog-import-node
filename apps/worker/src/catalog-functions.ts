import { Skail, SkailCommand, SkailFunction, SkailNonDeterministicError } from "@skail/runtime";
import {
  CatalogLimits,
  completedText,
  type ImportedPage,
  type ImportResult,
  type ImportStage,
} from "@skail-catalog-import/contracts";
import type { CatalogOperations } from "./catalog-operations.js";

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// The method names are PascalCase on purpose: the skail route is <workload>/<method>, and the web app triggers
// <workload>/ImportCatalog.
export class CatalogFunctions {
  constructor(private readonly operations: CatalogOperations) {}

  /**
   * Imports the catalog page by page, waiting 2 seconds between pages (the rate limit of the source API). After a
   * crash the run continues at the page where it stopped, and the pages already imported are not read again.
   */
  @SkailFunction()
  async ImportCatalog(importId: string): Promise<ImportResult> {
    let page = 1;
    let products = 0;
    try {
      await this.ReportStatus(importId, "Started", null);

      while (true) {
        // One command per page: when the source or the target fails, skail retries only this page.
        const result = await this.ImportPage(importId, page);
        products += result.imported;
        if (!result.hasMore || result.imported === 0 || page === CatalogLimits.maxPages) break;

        page++;
        await Skail.delaySeconds(CatalogLimits.secondsBetweenPages);
      }

      await this.ReportStatus(importId, "Completed", completedText(products, page));
      return { importId, pages: page, products };
    } catch (error) {
      // The pages already written stay written.
      if (!(error instanceof SkailNonDeterministicError))
        await this.ReportStatus(importId, "Failed", `Page ${page}: ${errorMessage(error)}`);
      throw error;
    }
  }

  // The commands only delegate to CatalogOperations, so their logic is tested without skail.

  @SkailCommand({ retryCount: 3 })
  async ImportPage(importId: string, page: number): Promise<ImportedPage> {
    return this.operations.importPage(importId, page);
  }

  /** Idempotent: the web app ignores a stage it already has. */
  @SkailCommand({ retryCount: 3 })
  async ReportStatus(importId: string, stage: ImportStage, detail: string | null): Promise<void> {
    await this.operations.reportStatus(importId, stage, detail);
  }
}
