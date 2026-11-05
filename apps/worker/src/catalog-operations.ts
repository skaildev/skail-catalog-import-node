import type { ImportEvent, ImportedPage, ImportStage } from "@skail-catalog-import/contracts";
import type { SourceCatalog } from "./source.js";
import type { ProgressNotifier, TargetCatalog } from "./web.js";

/**
 * The I/O behind the commands, as plain async methods. The command wrappers only delegate here, so the logic is
 * unit tested without the skail runtime.
 */
export class CatalogOperations {
  constructor(
    private readonly source: SourceCatalog,
    private readonly target: TargetCatalog,
    private readonly notifier: ProgressNotifier,
  ) {}

  /**
   * Reads the page from the source and writes it to the target. A retry runs both again: the read changes nothing
   * and the write replaces the page, so nothing is duplicated. Only the count goes back to the run history.
   */
  async importPage(importId: string, page: number): Promise<ImportedPage> {
    const started = Date.now();
    const { products, hasMore } = await this.source.getPage(page);
    await this.target.savePage(importId, { page, products, durationMs: Date.now() - started });
    return { imported: products.length, hasMore };
  }

  /** Idempotent: the web app ignores a stage it already has. */
  reportStatus(importId: string, stage: ImportStage, detail: string | null): Promise<void> {
    const event: ImportEvent = { importId, stage, detail };
    return this.notifier.notify(event);
  }
}
