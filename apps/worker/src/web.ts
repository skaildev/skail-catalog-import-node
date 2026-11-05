import type { ImportEvent, PageRecord } from "@skail-catalog-import/contracts";
import type { Fetch } from "./source.js";

/** The catalog the products go to. Writing the same import and page again replaces the page. */
export interface TargetCatalog {
  savePage(importId: string, record: PageRecord): Promise<void>;
}

export interface ProgressNotifier {
  notify(event: ImportEvent): Promise<void>;
}

async function post(
  fetchImpl: Fetch,
  baseUrl: string,
  importId: string,
  route: string,
  body: unknown,
  who: string,
  what: string,
) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const response = await fetchImpl(`${base}internal/imports/${encodeURIComponent(importId)}/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const reason = ((await response.json().catch(() => ({}))) as { error?: string }).error;
    throw new Error(`${who} answered ${response.status} to the ${what}${reason ? `: ${reason}` : ""}`);
  }
}

/** In this demo the web app plays the target catalog: POST {web}/internal/imports/{id}/pages. */
export class HttpTargetCatalog implements TargetCatalog {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
  ) {}

  savePage(importId: string, record: PageRecord): Promise<void> {
    return post(
      this.fetchImpl,
      this.baseUrl,
      importId,
      "pages",
      record,
      "Target catalog",
      `write of page ${record.page}`,
    );
  }
}

/** Reports progress to the web app: POST {web}/internal/imports/{id}/events. */
export class HttpProgressNotifier implements ProgressNotifier {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
  ) {}

  notify(event: ImportEvent): Promise<void> {
    return post(this.fetchImpl, this.baseUrl, event.importId, "events", event, "Web app", "progress event");
  }
}
