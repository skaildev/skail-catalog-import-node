import { Skail, SkailCommand, SkailFunction } from "@skail/runtime";
import { CatalogLimits, type ImportedPage, type ImportResult } from "./model.js";
import { getSourcePage } from "./source.js";

// Method names are PascalCase on purpose: the skail address is <workload>/<method>, and the trigger calls
// <workload>/ImportCatalog.
export class CatalogFunctions {
  /**
   * Imports the catalog page by page, waiting 2 seconds between pages (the rate limit of the source API). After an
   * app restart the run goes on at the page where it stopped, and the pages already imported are not read again.
   * The name and the parameter are the trigger contract: ["{importId}"].
   */
  @SkailFunction()
  async ImportCatalog(importId: string): Promise<ImportResult> {
    let page = 1;
    let products = 0;
    while (true) {
      // one command per page: when the source or the target fails, skail retries only this page
      const result = await this.ImportPage(importId, page);
      products += result.imported;
      if (!result.hasMore || result.imported === 0 || page === CatalogLimits.maxPages) break;

      page++;
      await Skail.delaySeconds(CatalogLimits.secondsBetweenPages); // durable: holds no thread or process
    }

    const result = { importId, pages: page, products };
    await this.ReportResult(result);
    return result;
  }

  /**
   * Reads the page from the source and writes it to the target catalog. A retry runs both again: the read changes
   * nothing and the write replaces the page, so nothing is duplicated. Only the count goes to the run history.
   */
  @SkailCommand({ retryCount: 3 })
  async ImportPage(importId: string, page: number): Promise<ImportedPage> {
    const read = await getSourcePage(page);
    await callApp("target", { importId, page, products: read.products });
    return { imported: read.products.length, hasMore: read.hasMore };
  }

  @SkailCommand()
  async ReportResult(result: ImportResult): Promise<void> {
    await callApp("result", result);
  }
}

/**
 * Calls the app, which plays the target catalog (src/import-desk.ts): commands run in an isolated VM, so they reach
 * it over HTTP, like they would reach a real catalog API.
 */
async function callApp(route: string, body: unknown): Promise<void> {
  const response = await fetch(`${process.env.DEMO_INTERNAL_URL}/internal/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${route} answered ${response.status}: ${await response.text()}`);
}
