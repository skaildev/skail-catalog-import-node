import { beforeEach, describe, expect, it } from "vitest";
import { EventType, type Provider } from "@skail/runtime";
import { createSkailWorker, type SkailWorker } from "@skail/runtime/testing";
import { InMemorySkailPlatform } from "@skail/testing";
import {
  CatalogLimits,
  type ImportedPage,
  type ImportEvent,
  type PageRecord,
  type SourcePage,
} from "@skail-catalog-import/contracts";
import { CatalogFunctions } from "../src/catalog-functions.js";
import { CatalogOperations } from "../src/catalog-operations.js";
import { FakeSourceCatalog, type SourceCatalog } from "../src/source.js";
import type { ProgressNotifier, TargetCatalog } from "../src/web.js";

const WORKLOAD = "catalog-import:v0.0.1";
const URI = `${WORKLOAD}/ImportCatalog`;

const decode = (data: unknown) =>
  JSON.parse(new TextDecoder().decode(Uint8Array.from(Object.values(data as Record<string, number>))));

class Harness {
  readonly read: number[] = [];
  readonly saved: PageRecord[] = [];
  readonly events: ImportEvent[] = [];
  rejectWrites = 0; // writes the target rejects before accepting
  alwaysFail = false;
  source: SourceCatalog = new FakeSourceCatalog();
  readonly platform = new InMemorySkailPlatform();
  readonly worker: SkailWorker;
  readonly importId = "import-1";

  constructor() {
    const source: SourceCatalog = {
      getPage: async (page): Promise<SourcePage> => {
        this.read.push(page);
        if (this.alwaysFail) throw new Error("Source API answered 503");
        return this.source.getPage(page);
      },
    };
    const target: TargetCatalog = {
      savePage: async (_importId, record) => {
        if (this.rejectWrites > 0) {
          this.rejectWrites--;
          throw new Error("Target catalog answered 503");
        }
        this.saved.push(record);
      },
    };
    const notifier: ProgressNotifier = { notify: async (event) => void this.events.push(event) };
    const providers: Provider[] = [
      {
        token: CatalogFunctions,
        useFactory: () => new CatalogFunctions(new CatalogOperations(source, target, notifier)),
      },
    ];
    this.worker = createSkailWorker({
      workload: WORKLOAD,
      types: [CatalogFunctions],
      providers,
      sidecar: this.platform,
    });
  }

  start() {
    this.platform.start(URI, [this.importId], this.importId);
  }

  async run() {
    return this.worker.runActivation((await this.platform.consume())!);
  }

  pending(eventType: EventType) {
    return this.platform.history(this.importId).filter((f) => f.eventType === eventType && !f.targetResult);
  }

  async elapse() {
    const [delay] = this.pending(EventType.Delay);
    expect(delay).toBeDefined();
    this.platform.complete(this.importId, delay!.index);
    return this.run();
  }

  /** Runs the whole import, completing each 2-second delay. */
  async runToEnd() {
    let outcome = await this.run();
    while (outcome.status === "hibernated" && this.pending(EventType.Delay).length > 0) outcome = await this.elapse();
    return outcome;
  }
}

let h: Harness;
beforeEach(() => {
  h = new Harness();
});

describe("ImportCatalog", () => {
  it("reports Started, imports page 1 and hibernates on the 2-second delay", async () => {
    h.start();
    expect(await h.run()).toMatchObject({ status: "hibernated" });

    expect(h.events).toEqual([{ importId: "import-1", stage: "Started", detail: null }]);
    expect(h.read).toEqual([1]);
    expect(h.saved.map((p) => p.page)).toEqual([1]);
    expect(h.pending(EventType.Delay)).toHaveLength(1);
  });

  it("waits 2 seconds between pages", async () => {
    h.start();
    await h.run();
    const [delay] = h.pending(EventType.Delay);
    expect(decode(delay!.targetArguments[0]!.data)).toBe(CatalogLimits.secondsBetweenPages);
  });

  it("imports 194 products in 10 pages (nine of 20, the last of 14), with 9 delays and none after the last", async () => {
    h.start();
    const outcome = await h.runToEnd();

    expect(outcome).toEqual({ status: "completed", result: { importId: "import-1", pages: 10, products: 194 } });
    expect(h.saved.map((p) => p.products.length)).toEqual([20, 20, 20, 20, 20, 20, 20, 20, 20, 14]);
    expect(h.read).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // no page read twice
    expect(h.platform.history(h.importId).filter((f) => f.eventType === EventType.Delay)).toHaveLength(9);
    expect(h.events.at(-1)).toEqual({ importId: "import-1", stage: "Completed", detail: "194 products in 10 pages" });
  });

  it("stops when a page has no products, even if the source says there is more", async () => {
    h.source = { getPage: async () => ({ products: [], hasMore: true }) };
    h.start();
    expect(await h.run()).toEqual({ status: "completed", result: { importId: "import-1", pages: 1, products: 0 } });
  });

  it("stops at maxPages when the source never reports the end", async () => {
    h.source = {
      getPage: async (page) => ({ products: [{ id: page, title: "x", category: null, price: 1 }], hasMore: true }),
    };
    h.start();
    const outcome = await h.runToEnd();
    expect(outcome).toEqual({
      status: "completed",
      result: { importId: "import-1", pages: CatalogLimits.maxPages, products: CatalogLimits.maxPages },
    });
  }, 60_000);

  it("retries only the page whose write was rejected: the earlier pages are not read again", async () => {
    h.start();
    await h.run(); // page 1
    h.rejectWrites = 2;
    let outcome = await h.elapse(); // page 2: rejected, skail delivers the run again
    expect(outcome.status).toBe("hibernated");
    for (let i = 0; i < 2; i++) {
      h.platform.enqueue(h.importId);
      outcome = await h.run();
    }

    expect(h.read).toEqual([1, 2, 2, 2]);
    expect(h.saved.map((p) => p.page)).toEqual([1, 2]);
    expect(h.pending(EventType.Delay)).toHaveLength(1); // waiting before page 3
  });

  it("reports Failed with the page and the message when a page fails for good; saved pages stay saved", async () => {
    h.start();
    await h.run(); // page 1 saved
    await h.elapse(); // page 2 saved
    expect(h.saved.map((p) => p.page)).toEqual([1, 2]);

    h.alwaysFail = true;
    h.platform.complete(h.importId, h.pending(EventType.Delay)[0]!.index);
    for (let i = 0; i < 8 && !h.events.some((e) => e.stage === "Failed"); i++) {
      h.platform.enqueue(h.importId);
      const activation = await h.platform.consume();
      if (!activation) break;
      await h.worker.runActivation(activation);
    }

    expect(h.events.find((e) => e.stage === "Failed")).toEqual({
      importId: "import-1",
      stage: "Failed",
      detail: "Page 3: Source API answered 503",
    });
    expect(h.saved.map((p) => p.page)).toEqual([1, 2]);
  });

  it("ImportPage returns only the count and hasMore: the products do not go to the history", async () => {
    h.start();
    await h.run();
    const command = h.platform
      .history(h.importId)
      .find((f) => f.eventType === EventType.Durable && /ImportPage/.test(f.targetUri ?? ""));
    expect(command).toBeDefined();
    expect(decode(command!.targetResult!.data) as ImportedPage).toEqual({ imported: 20, hasMore: true });
  });
});
