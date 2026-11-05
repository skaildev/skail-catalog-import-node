import { describe, expect, it } from "vitest";
import {
  CatalogLimits,
  SimulatedFailure,
  buttonRules,
  completedText,
  importedCount,
  isTerminal,
  type ImportEvent,
  type ImportStage,
  type ImportState,
} from "../src/index.js";

const state = (stage: ImportStage, patch: Partial<ImportState> = {}): ImportState => ({
  importId: "i1",
  stage,
  simulateFailure: false,
  pages: [],
  detail: null,
  ...patch,
});

describe("CatalogLimits", () => {
  it("has the demo constants: 20 per page, 2 s between pages, 50 pages as a safety cap", () => {
    expect(CatalogLimits).toMatchObject({ pageSize: 20, secondsBetweenPages: 2, maxPages: 50, expectedProducts: 194 });
  });

  it("derives 10 expected pages from 194 products at 20 per page", () => {
    expect(CatalogLimits.expectedPages).toBe(10);
  });

  it("simulates the failure on a page inside the catalog, fewer times than the command retries", () => {
    expect(SimulatedFailure.page).toBeLessThanOrEqual(CatalogLimits.expectedPages);
    expect(SimulatedFailure.times).toBeLessThan(3);
  });
});

describe("isTerminal", () => {
  it("is true only for Completed and Failed", () => {
    expect(["Starting", "Started"].some((s) => isTerminal(s as ImportStage))).toBe(false);
    expect(isTerminal("Completed")).toBe(true);
    expect(isTerminal("Failed")).toBe(true);
  });
});

describe("buttonRules", () => {
  it("is enabled as 'Import catalog' with no import or a finished one", () => {
    const idle = { label: "Import catalog", enabled: true };
    expect(buttonRules(undefined)).toEqual(idle);
    expect(buttonRules(state("Completed"))).toEqual(idle);
    expect(buttonRules(state("Failed"))).toEqual(idle);
  });

  it("is disabled as 'Importing…' while an import is in progress", () => {
    const busy = { label: "Importing…", enabled: false };
    expect(buttonRules(state("Starting"))).toEqual(busy);
    expect(buttonRules(state("Started"))).toEqual(busy);
  });
});

describe("importedCount", () => {
  it("sums the products of the saved pages and ignores a page the target rejected", () => {
    const pages = [
      { page: 1, products: 20, durationMs: 5, attempts: 1 },
      { page: 2, products: 14, durationMs: 5, attempts: 2 },
      { page: 3, products: null, durationMs: null, attempts: 1 },
    ];
    expect(importedCount(state("Started", { pages }))).toBe(34);
  });
});

describe("completedText", () => {
  it("says how many products and pages", () => {
    expect(completedText(194, 10)).toBe("194 products in 10 pages");
    expect(completedText(0, 1)).toBe("0 products in 1 page");
  });
});

describe("serialization", () => {
  it("ImportEvent has the same property names in both languages (camelCase)", () => {
    const event: ImportEvent = { importId: "i1", stage: "Failed", detail: "Page 3: boom" };
    expect(Object.keys(JSON.parse(JSON.stringify(event))).sort()).toEqual(["detail", "importId", "stage"]);
  });
});
