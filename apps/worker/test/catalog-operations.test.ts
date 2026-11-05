import { describe, expect, it } from "vitest";
import type { ImportEvent, PageRecord } from "@skail-catalog-import/contracts";
import { CatalogOperations } from "../src/catalog-operations.js";
import { FakeSourceCatalog } from "../src/source.js";

function setup(rejectWrites = 0) {
  const saved: Array<{ importId: string; record: PageRecord }> = [];
  const events: ImportEvent[] = [];
  let rejections = rejectWrites;
  const operations = new CatalogOperations(
    new FakeSourceCatalog(),
    {
      savePage: async (importId, record) => {
        if (rejections-- > 0) throw new Error("Target catalog answered 503");
        saved.push({ importId, record });
      },
    },
    { notify: async (event) => void events.push(event) },
  );
  return { operations, saved, events };
}

describe("CatalogOperations.importPage", () => {
  it("reads the page from the source, writes it to the target and returns only the count", async () => {
    const { operations, saved } = setup();

    expect(await operations.importPage("i1", 2)).toEqual({ imported: 20, hasMore: true });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ importId: "i1", record: { page: 2 } });
    expect(saved[0]!.record.products.map((p) => p.id)).toEqual(Array.from({ length: 20 }, (_, i) => 21 + i));
  });

  it("returns hasMore false on the last page, with 14 products", async () => {
    const { operations } = setup();
    expect(await operations.importPage("i1", 10)).toEqual({ imported: 14, hasMore: false });
  });

  it("throws when the target rejects the write, so skail retries the whole command", async () => {
    const { operations, saved } = setup(1);
    await expect(operations.importPage("i1", 3)).rejects.toThrow(/503/);
    expect(saved).toHaveLength(0);

    await operations.importPage("i1", 3);
    expect(saved.map((s) => s.record.page)).toEqual([3]);
  });
});

describe("CatalogOperations.reportStatus", () => {
  it("sends the stage and the detail of the import", async () => {
    const { operations, events } = setup();
    await operations.reportStatus("i1", "Completed", "194 products in 10 pages");
    expect(events).toEqual([{ importId: "i1", stage: "Completed", detail: "194 products in 10 pages" }]);
  });
});
