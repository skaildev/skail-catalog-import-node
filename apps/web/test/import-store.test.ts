import { beforeEach, describe, expect, it } from "vitest";
import type { ImportEvent, ImportState, PageRecord } from "@skail-catalog-import/contracts";
import { ImportStore } from "../src/import-store.js";

const record = (page: number, products = 20, durationMs = 5): PageRecord => ({
  page,
  durationMs,
  products: Array.from({ length: products }, (_, i) => ({
    id: (page - 1) * 20 + i + 1,
    title: "p",
    category: null,
    price: 1,
  })),
});
const event = (patch: Partial<ImportEvent>): ImportEvent => ({
  importId: "i1",
  stage: "Started",
  detail: null,
  ...patch,
});

let store: ImportStore;
beforeEach(() => {
  store = new ImportStore();
  store.create("i1");
});

describe("ImportStore", () => {
  it("creates an import in Starting with no pages", () => {
    expect(store.get("i1")).toEqual({
      importId: "i1",
      stage: "Starting",
      simulateFailure: false,
      pages: [],
      detail: null,
    });
    expect(store.get("nope")).toBeUndefined();
  });

  it("saves a page: products, duration and one attempt; the import moves to Started", () => {
    expect(store.savePage("i1", record(1))).toBe("saved");
    expect(store.get("i1")).toMatchObject({
      stage: "Started",
      pages: [{ page: 1, products: 20, durationMs: 5, attempts: 1 }],
    });
  });

  it("is idempotent: the same page twice replaces it (no duplicate products) and counts 2 attempts", () => {
    store.savePage("i1", record(1));
    store.savePage("i1", record(1, 20, 9));

    expect(store.get("i1")!.pages).toEqual([{ page: 1, products: 20, durationMs: 9, attempts: 2 }]);
    expect(store.products("i1")).toHaveLength(20);
  });

  it("keeps pages ordered and the products without duplicates (194 in 10 pages)", () => {
    for (const n of [4, 1, 3, 2, 10, 9, 8, 7, 6, 5]) store.savePage("i1", record(n, n === 10 ? 14 : 20));
    store.savePage("i1", record(5));

    expect(store.get("i1")!.pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(store.products("i1")).toHaveLength(194);
    expect(new Set(store.products("i1").map((p) => p.id)).size).toBe(194);
    expect(store.get("i1")!.pages.find((p) => p.page === 5)!.attempts).toBe(2);
  });

  it("with the simulated failure, rejects the first 2 writes of page 3 and accepts the third", () => {
    store.create("i2", true);
    store.savePage("i2", record(1));
    store.savePage("i2", record(2));

    expect(store.savePage("i2", record(3))).toBe("rejected");
    expect(store.get("i2")!.pages.at(-1)).toEqual({ page: 3, products: null, durationMs: null, attempts: 1 });
    expect(store.savePage("i2", record(3))).toBe("rejected");
    expect(store.savePage("i2", record(3))).toBe("saved");
    expect(store.get("i2")!.pages.at(-1)).toEqual({ page: 3, products: 20, durationMs: 5, attempts: 3 });
    expect(store.savePage("i2", record(4))).toBe("saved");
  });

  it("without the simulated failure, accepts page 3 on the first write", () => {
    expect(store.savePage("i1", record(3))).toBe("saved");
  });

  it("ignores pages of an unknown import", () => {
    expect(store.savePage("nope", record(1))).toBe("unknown");
  });

  it("applies events and ignores a stage it already has", () => {
    expect(store.apply(event({ stage: "Started" }))).toBe(true);
    expect(store.apply(event({ stage: "Started" }))).toBe(false);
    expect(store.apply(event({ stage: "Completed", detail: "194 products in 10 pages" }))).toBe(true);
    expect(store.get("i1")).toMatchObject({ stage: "Completed", detail: "194 products in 10 pages" });
  });

  it("records the detail of Failed and ignores events after the end", () => {
    store.apply(event({ stage: "Failed", detail: "Page 2: boom" }));
    expect(store.get("i1")).toMatchObject({ stage: "Failed", detail: "Page 2: boom" });
    expect(store.apply(event({ stage: "Completed" }))).toBe(false);
    expect(store.get("i1")!.stage).toBe("Failed");
  });

  it("keeps the saved pages when the import fails", () => {
    store.savePage("i1", record(1));
    store.apply(event({ stage: "Failed", detail: "x" }));
    expect(store.get("i1")!.pages).toHaveLength(1);
  });

  it("publishes every change to subscribers and closes them when the import ends", () => {
    const seen: ImportState[] = [];
    let closed = false;
    store.subscribe(
      "i1",
      (s) => seen.push(s),
      () => (closed = true),
    );

    store.savePage("i1", record(1));
    store.apply(event({ stage: "Completed" }));

    expect(seen.map((s) => s.stage)).toEqual(["Started", "Completed"]);
    expect(closed).toBe(true);
  });

  it("unsubscribe stops the updates; remove closes the subscribers and forgets the import", () => {
    const seen: ImportState[] = [];
    let closed = false;
    const off = store.subscribe(
      "i1",
      (s) => seen.push(s),
      () => (closed = true),
    );
    off();
    store.savePage("i1", record(1));
    expect(seen).toHaveLength(0);

    store.subscribe(
      "i1",
      () => {},
      () => (closed = true),
    );
    store.remove("i1");
    expect(closed).toBe(true);
    expect(store.get("i1")).toBeUndefined();
    expect(store.count).toBe(0);
  });
});
