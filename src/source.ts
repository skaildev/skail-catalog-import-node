import { CatalogLimits, type SourcePage } from "./model.js";

/**
 * The catalog the products come from: DummyJSON, a free public API with 194 products and no key.
 * GET https://dummyjson.com/products?limit=20&skip={(page - 1) * 20}&select=id,title,category,price
 */
export async function getSourcePage(page: number): Promise<SourcePage> {
  const skip = (page - 1) * CatalogLimits.pageSize;
  const url = `https://dummyjson.com/products?limit=${CatalogLimits.pageSize}&skip=${skip}&select=id,title,category,price`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const content = await response.text();
  if (!response.ok) throw new Error(`Source API answered ${response.status}: ${content.slice(0, 300)}`);

  const body = JSON.parse(content) as { products: SourcePage["products"]; total: number };
  const products = body.products.map(({ id, title, category, price }) => ({ id, title, category, price }));
  return { products, hasMore: skip + products.length < body.total };
}
