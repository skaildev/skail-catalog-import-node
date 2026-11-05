import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buttonRules,
  importedCount,
  type ImportState,
  type ImportView,
  type PageSummary,
} from "@skail-catalog-import/contracts";
import { App } from "../src/App";

const view = (patch: Partial<ImportState> = {}): ImportView => {
  const state: ImportState = {
    importId: "import-1",
    stage: "Starting",
    simulateFailure: false,
    pages: [],
    detail: null,
    ...patch,
  };
  return { ...state, imported: importedCount(state), expectedProducts: 194, expectedPages: 10, ui: buttonRules(state) };
};
const page = (n: number, products: number | null = 20, attempts = 1): PageSummary => ({
  page: n,
  products,
  durationMs: products === null ? null : 120 + n,
  attempts,
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(data: ImportView) {
    act(() => this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent));
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let calls: Array<{ url: string; method: string; body: unknown }>;
let answers: Record<string, () => Response>;

beforeEach(() => {
  calls = [];
  answers = {};
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers[`${method} ${url}`];
    if (!answer) throw new Error(`unexpected ${method} ${url}`);
    return answer();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

const button = () => screen.getByRole("button");
const checkbox = () => screen.getByRole("checkbox");

async function startImport() {
  answers["POST /api/imports"] = () => json(view());
  render(<App />);
  await userEvent.click(button());
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  return FakeEventSource.instances[0]!;
}

describe("App", () => {
  it("starts idle with an enabled 'Import catalog' button and the failure checkbox off", () => {
    render(<App />);
    expect(button()).toHaveTextContent("Import catalog");
    expect(button()).toBeEnabled();
    expect(checkbox()).not.toBeChecked();
    expect(screen.getByLabelText("Make the target catalog reject page 3 twice")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("click starts an import: 'Importing…' disabled, id in the footer and remembered, stream opened", async () => {
    await startImport();

    expect(button()).toHaveTextContent("Importing…");
    expect(button()).toBeDisabled();
    expect(checkbox()).toBeDisabled();
    expect(calls[0]).toEqual({ url: "/api/imports", method: "POST", body: { simulateFailure: false } });
    expect(screen.getByText("import-1")).toBeInTheDocument();
    expect(localStorage.getItem("catalog-import.importId")).toBe("import-1");
    expect(FakeEventSource.instances[0]!.url).toBe("/api/imports/import-1/stream");
  });

  it("sends the simulated failure when the checkbox is on", async () => {
    answers["POST /api/imports"] = () => json(view({ simulateFailure: true }));
    render(<App />);
    await userEvent.click(checkbox());
    await userEvent.click(button());

    expect(calls[0]!.body).toEqual({ simulateFailure: true });
  });

  it("shows progress, saved pages and the table from the stream", async () => {
    const stream = await startImport();
    stream.emit(view({ stage: "Started", pages: [page(1), page(2)] }));

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "194");
    expect(screen.getByText("40/194 products")).toBeInTheDocument();
    expect(screen.getByText("2/10 pages")).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent("2");
    expect(rows[1]).toHaveTextContent("20");
    expect(rows[1]).toHaveTextContent("122 ms");
  });

  it("counts down the 2-second wait between pages, then shows the next page being imported", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answers["POST /api/imports"] = () => json(view());
    render(<App />);
    await act(async () => void button().click());
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const stream = FakeEventSource.instances[0]!;

    stream.emit(view({ stage: "Started", pages: [] }));
    expect(screen.getByText("Importing page 1/10")).toBeInTheDocument();

    stream.emit(view({ stage: "Started", pages: [page(1)] }));
    expect(screen.getByText("Next page in 2s")).toBeInTheDocument();

    await act(async () => void vi.advanceTimersByTime(2100));
    expect(screen.getByText("Importing page 2/10")).toBeInTheDocument();
  });

  it("shows a rejected page as retrying and highlights a page written more than once", async () => {
    const stream = await startImport();

    stream.emit(view({ stage: "Started", simulateFailure: true, pages: [page(1), page(2), page(3, null, 1)] }));
    let rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows[2]).toHaveTextContent("rejected, retrying");
    expect(screen.getByText("40/194 products")).toBeInTheDocument();

    stream.emit(view({ stage: "Started", simulateFailure: true, pages: [page(1), page(2), page(3, 20, 3)] }));
    rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows[0]).not.toHaveClass("retried");
    expect(rows[2]).toHaveClass("retried");
    expect(rows[2]).toHaveTextContent("3");
  });

  it("Completed: 194/194 in 10 pages, stream closed, button back, a new click makes a new import", async () => {
    const stream = await startImport();
    const pages = Array.from({ length: 10 }, (_, i) => page(i + 1, i === 9 ? 14 : 20));

    stream.emit(view({ stage: "Completed", pages, detail: "194 products in 10 pages" }));

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("194 products in 10 pages")).toBeInTheDocument();
    expect(screen.getByText("194/194 products")).toBeInTheDocument();
    expect(button()).toHaveTextContent("Import catalog");
    expect(button()).toBeEnabled();
    expect(stream.closed).toBe(true);
    expect(localStorage.getItem("catalog-import.importId")).toBeNull();

    answers["POST /api/imports"] = () => json(view({ importId: "import-2" }));
    await userEvent.click(button());
    await waitFor(() => expect(screen.getByText("import-2")).toBeInTheDocument());
  });

  it("Failed: shows the detail as an error, keeps the imported pages and re-enables the button", async () => {
    const stream = await startImport();
    stream.emit(view({ stage: "Failed", pages: [page(1)], detail: "Page 2: Source API answered 503" }));

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Page 2: Source API answered 503")).toHaveClass("error");
    expect(screen.getByText("20/194 products")).toBeInTheDocument();
    expect(button()).toBeEnabled();
  });

  it("shows the error when the start fails and keeps the button enabled", async () => {
    answers["POST /api/imports"] = () => json({ error: "skail down" }, 502);
    render(<App />);
    await userEvent.click(button());

    expect(await screen.findByText(/skail down/)).toBeInTheDocument();
    expect(button()).toBeEnabled();
  });

  it("on reload it restores the import from the server, with the checkbox, and reconnects", async () => {
    localStorage.setItem("catalog-import.importId", "import-1");
    answers["GET /api/imports/import-1"] = () =>
      json(view({ stage: "Started", simulateFailure: true, pages: [page(1), page(2), page(3)] }));
    render(<App />);

    expect(await screen.findByText("60/194 products")).toBeInTheDocument();
    expect(button()).toBeDisabled();
    expect(checkbox()).toBeChecked();
    await waitFor(() => expect(FakeEventSource.instances[0]?.url).toBe("/api/imports/import-1/stream"));
  });

  it("forgets a saved import the server does not know", async () => {
    localStorage.setItem("catalog-import.importId", "gone");
    answers["GET /api/imports/gone"] = () => new Response(null, { status: 404 });
    render(<App />);

    await waitFor(() => expect(localStorage.getItem("catalog-import.importId")).toBeNull());
    expect(button()).toBeEnabled();
  });
});
