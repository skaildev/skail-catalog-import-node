import { beforeEach, describe, expect, it } from "vitest";
import type { ImportEvent, PageRecord } from "@skail-catalog-import/contracts";
import { createApp } from "../src/app.js";
import { SkailGatewayError, type SkailGateway } from "../src/gateway.js";
import { ImportStore } from "../src/import-store.js";

class FakeGateway implements SkailGateway {
  triggers: string[] = [];
  failTrigger = false;
  async trigger(importId: string) {
    if (this.failTrigger) throw new SkailGatewayError("skail down");
    this.triggers.push(importId);
  }
}

let store: ImportStore;
let gateway: FakeGateway;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  store = new ImportStore();
  gateway = new FakeGateway();
  app = createApp({ store, gateway });
});

const start = (simulateFailure?: boolean) =>
  app.inject({
    method: "POST",
    url: "/api/imports",
    payload: simulateFailure === undefined ? {} : { simulateFailure },
  });
const report = (importId: string, event: Partial<ImportEvent>) =>
  app.inject({
    method: "POST",
    url: `/internal/imports/${importId}/events`,
    payload: { importId: "ignored", stage: "Started", detail: null, ...event },
  });
const savePage = (importId: string, page: number, products = 20) =>
  app.inject({
    method: "POST",
    url: `/internal/imports/${importId}/pages`,
    payload: {
      page,
      durationMs: 7,
      products: Array.from({ length: products }, (_, i) => ({
        id: (page - 1) * 20 + i + 1,
        title: "p",
        category: "c",
        price: 2,
      })),
    } satisfies PageRecord,
  });

describe("web API", () => {
  it("answers /healthz", async () => {
    expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
  });

  it("POST /api/imports starts a run with the import id and returns the view with the button state", async () => {
    const res = await start();
    expect(res.statusCode).toBe(200);
    const view = res.json();

    expect(gateway.triggers).toEqual([view.importId]);
    expect(view).toEqual({
      importId: view.importId,
      stage: "Starting",
      simulateFailure: false,
      imported: 0,
      expectedProducts: 194,
      expectedPages: 10,
      pages: [],
      detail: null,
      ui: { label: "Importing…", enabled: false },
    });
  });

  it("uses a new import id on each click", async () => {
    const a = (await start()).json();
    const b = (await start()).json();
    expect(a.importId).not.toBe(b.importId);
  });

  it("answers 502 and forgets the import when the trigger fails", async () => {
    gateway.failTrigger = true;
    const res = await start();
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("skail down");
    expect(store.count).toBe(0);
  });

  it("internal pages: 204, stage Started, imported grows, the same page twice counts 2 attempts", async () => {
    const { importId } = (await start()).json();
    expect((await savePage(importId, 1)).statusCode).toBe(204);
    await savePage(importId, 2);
    await savePage(importId, 2);

    const view = (await app.inject({ url: `/api/imports/${importId}` })).json();
    expect(view).toMatchObject({ stage: "Started", imported: 40 });
    expect(view.pages).toEqual([
      { page: 1, products: 20, durationMs: 7, attempts: 1 },
      { page: 2, products: 20, durationMs: 7, attempts: 2 },
    ]);
  });

  it("with the simulated failure, answers 503 to the first 2 writes of page 3 and 204 to the third", async () => {
    const { importId, simulateFailure } = (await start(true)).json();
    expect(simulateFailure).toBe(true);

    const first = await savePage(importId, 3);
    expect(first.statusCode).toBe(503);
    expect(first.json()).toEqual({ error: "simulated failure on page 3" });
    expect((await savePage(importId, 3)).statusCode).toBe(503);
    expect((await savePage(importId, 3)).statusCode).toBe(204);
  });

  it("internal events use the id of the URL; Completed re-enables the button; repeated events are ignored", async () => {
    const { importId } = (await start()).json();
    expect((await report(importId, { stage: "Started" })).statusCode).toBe(204);
    await report(importId, { stage: "Started" });
    await report(importId, { stage: "Completed", detail: "194 products in 10 pages" });

    const view = (await app.inject({ url: `/api/imports/${importId}` })).json();
    expect(view).toMatchObject({
      stage: "Completed",
      detail: "194 products in 10 pages",
      ui: { label: "Import catalog", enabled: true },
    });
  });

  it("Failed carries the detail and keeps the saved pages", async () => {
    const { importId } = (await start()).json();
    await savePage(importId, 1);
    await report(importId, { stage: "Failed", detail: "Page 2: Source API answered 503" });

    const view = (await app.inject({ url: `/api/imports/${importId}` })).json();
    expect(view).toMatchObject({ stage: "Failed", detail: "Page 2: Source API answered 503", imported: 20 });
  });

  it("GET of an unknown import is 404", async () => {
    expect((await app.inject({ url: "/api/imports/nope" })).statusCode).toBe(404);
  });

  it("SSE sends the snapshot, then every change in order, and ends when the import ends", async () => {
    const { importId } = (await start()).json();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as { port: number };

    const response = await fetch(`http://127.0.0.1:${port}/api/imports/${importId}/stream`);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const stages: string[] = [];
    let buffer = "";
    const read = async (until: number) => {
      while (stages.length < until) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value);
        const parts = buffer.split("\n\n");
        buffer = parts.pop()!;
        for (const part of parts) stages.push(JSON.parse(part.replace(/^data: /, "")).stage);
      }
    };

    await read(1);
    await savePage(importId, 1);
    await read(2);
    await report(importId, { stage: "Completed" });
    await read(3);
    const end = await reader.read();

    expect(stages).toEqual(["Starting", "Started", "Completed"]);
    expect(end.done).toBe(true);
    await app.close();
  });

  it("SSE of an unknown import is 404", async () => {
    expect((await app.inject({ url: "/api/imports/nope/stream" })).statusCode).toBe(404);
  });
});
