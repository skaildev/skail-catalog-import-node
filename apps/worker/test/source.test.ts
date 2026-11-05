import { describe, expect, it } from "vitest";
import { CatalogLimits } from "@skail-catalog-import/contracts";
import { FakeSourceCatalog, HttpSourceCatalog } from "../src/source.js";

const dummy = (skip: number, count: number, total = 194) =>
  Response.json({
    products: Array.from({ length: count }, (_, i) => ({
      id: skip + i + 1,
      title: `P${skip + i + 1}`,
      category: "beauty",
      price: 9.99,
    })),
    total,
    skip,
    limit: 20,
  });

describe("HttpSourceCatalog", () => {
  it("requests limit, skip and select for the page (pages start at 1) and maps the products", async () => {
    const urls: string[] = [];
    const source = new HttpSourceCatalog("https://dummyjson.com/", async (url) => {
      urls.push(String(url));
      return dummy(40, 20);
    });

    const page = await source.getPage(3);

    expect(urls).toEqual(["https://dummyjson.com/products?limit=20&skip=40&select=id,title,category,price"]);
    expect(page.products).toHaveLength(20);
    expect(page.products[0]).toEqual({ id: 41, title: "P41", category: "beauty", price: 9.99 });
    expect(page.hasMore).toBe(true);
  });

  it("hasMore is false on the last page (skip + products >= total)", async () => {
    const source = new HttpSourceCatalog("https://x", async () => dummy(180, 14));
    expect((await source.getPage(10)).hasMore).toBe(false);
  });

  it("throws with the status and the body on an HTTP error, so skail retries the command", async () => {
    const source = new HttpSourceCatalog("https://x", async () => new Response("rate limited", { status: 429 }));
    await expect(source.getPage(1)).rejects.toThrow(/429.*rate limited/);
  });
});

describe("FakeSourceCatalog", () => {
  it("serves 194 products in 10 pages: nine of 20 and a last one of 14", async () => {
    const source = new FakeSourceCatalog();
    const pages = [];
    for (let page = 1; page <= CatalogLimits.expectedPages; page++) pages.push(await source.getPage(page));

    expect(pages.map((p) => p.products.length)).toEqual([20, 20, 20, 20, 20, 20, 20, 20, 20, 14]);
    expect(pages.map((p) => p.hasMore)).toEqual([...Array(9).fill(true), false]);
    const ids = pages.flatMap((p) => p.products.map((x) => x.id));
    expect(new Set(ids).size).toBe(194);
  });

  it("past the end it returns an empty page without more", async () => {
    expect(await new FakeSourceCatalog().getPage(11)).toEqual({ products: [], hasMore: false });
  });
});
