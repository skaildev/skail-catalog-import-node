import { CatalogLimits, type Product, type SourcePage } from "@skail-catalog-import/contracts";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The catalog the products come from. Pages start at 1. */
export interface SourceCatalog {
  getPage(page: number): Promise<SourcePage>;
}

/** DummyJSON: GET {base}/products?limit=20&skip={(page - 1) * 20}&select=id,title,category,price. No key. */
export class HttpSourceCatalog implements SourceCatalog {
  readonly #baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
  ) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async getPage(page: number): Promise<SourcePage> {
    const skip = (page - 1) * CatalogLimits.pageSize;
    const response = await this.fetchImpl(
      `${this.#baseUrl}/products?limit=${CatalogLimits.pageSize}&skip=${skip}&select=id,title,category,price`,
    );
    const content = await response.text();
    if (!response.ok) throw new Error(`Source API answered ${response.status}: ${content.slice(0, 300)}`);

    const body = JSON.parse(content) as { products: Array<Partial<Product>>; total: number };
    const products = body.products.map((p) => ({
      id: p.id!,
      title: p.title ?? "",
      category: p.category ?? null,
      price: p.price ?? 0,
    }));
    return { products, hasMore: skip + products.length < body.total };
  }
}

/** Offline source (SOURCE_PROVIDER=fake) with the 194 products of the demo. */
export class FakeSourceCatalog implements SourceCatalog {
  async getPage(page: number): Promise<SourcePage> {
    const skip = (page - 1) * CatalogLimits.pageSize;
    const count = Math.max(0, Math.min(CatalogLimits.pageSize, CatalogLimits.expectedProducts - skip));
    const products: Product[] = Array.from({ length: count }, (_, i) => {
      const id = skip + i + 1;
      return { id, title: `Product ${id}`, category: `category-${id % 5}`, price: 5 + (id % 50) };
    });
    return { products, hasMore: skip + count < CatalogLimits.expectedProducts };
  }
}
