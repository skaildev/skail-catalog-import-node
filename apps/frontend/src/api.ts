import type { ImportView } from "@skail-catalog-import/contracts";

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `HTTP ${res.status}`);
}

export async function startImport(simulateFailure: boolean): Promise<ImportView> {
  const res = await fetch("/api/imports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ simulateFailure }),
  });
  if (!res.ok) throw await failure(res);
  return res.json();
}

export async function getImport(importId: string): Promise<ImportView | null> {
  const res = await fetch(`/api/imports/${importId}`);
  return res.ok ? res.json() : null;
}
