import { describe, expect, it } from "vitest";
import type { ImportEvent, PageRecord } from "@skail-catalog-import/contracts";
import { HttpProgressNotifier, HttpTargetCatalog } from "../src/web.js";

const record: PageRecord = { page: 3, products: [{ id: 41, title: "P41", category: null, price: 1 }], durationMs: 12 };

function recorder(status = 204, body: unknown = null) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return status === 204 ? new Response(null, { status }) : Response.json(body ?? {}, { status });
  };
  return { calls, fetchImpl };
}

describe("HttpTargetCatalog", () => {
  it("posts the page as JSON to internal/imports/{id}/pages", async () => {
    const { calls, fetchImpl } = recorder();
    await new HttpTargetCatalog("http://web:8080", fetchImpl).savePage("import 1", record);

    expect(calls[0]!.url).toBe("http://web:8080/internal/imports/import%201/pages");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(record);
    expect(new Headers(calls[0]!.init.headers).get("content-type")).toBe("application/json");
  });

  it("throws with the status and the reason when the write is rejected, so skail retries the command", async () => {
    const { fetchImpl } = recorder(503, { error: "simulated failure on page 3" });
    await expect(new HttpTargetCatalog("http://web:8080/", fetchImpl).savePage("i", record)).rejects.toThrow(
      "Target catalog answered 503 to the write of page 3: simulated failure on page 3",
    );
  });
});

describe("HttpProgressNotifier", () => {
  const event: ImportEvent = { importId: "import 1", stage: "Started", detail: null };

  it("posts the event as JSON to internal/imports/{id}/events", async () => {
    const { calls, fetchImpl } = recorder();
    await new HttpProgressNotifier("http://web:8080", fetchImpl).notify(event);

    expect(calls[0]!.url).toBe("http://web:8080/internal/imports/import%201/events");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(event);
  });

  it("throws when the web app answers an error", async () => {
    const { fetchImpl } = recorder(500);
    await expect(new HttpProgressNotifier("http://web:8080", fetchImpl).notify(event)).rejects.toThrow(
      "Web app answered 500 to the progress event",
    );
  });
});
