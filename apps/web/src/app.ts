import { randomUUID } from "node:crypto";
import fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import {
  CatalogLimits,
  SimulatedFailure,
  buttonRules,
  importedCount,
  isTerminal,
  type ImportEvent,
  type ImportState,
  type ImportView,
  type PageRecord,
} from "@skail-catalog-import/contracts";
import { SkailGatewayError, type SkailGateway } from "./gateway.js";
import type { ImportStore } from "./import-store.js";

export interface AppOptions {
  store: ImportStore;
  gateway: SkailGateway;
  /** Directory with the built front end (index.html + assets). Optional: tests do not need it. */
  staticDir?: string;
}

export function toView(state: ImportState): ImportView {
  return {
    ...state,
    imported: importedCount(state),
    expectedProducts: CatalogLimits.expectedProducts,
    expectedPages: CatalogLimits.expectedPages,
    ui: buttonRules(state),
  };
}

export function createApp({ store, gateway, staticDir }: AppOptions): FastifyInstance {
  const app = fastify({ bodyLimit: 5 * 1024 * 1024 });

  app.get("/healthz", async () => "ok");

  app.post<{ Body: { simulateFailure?: unknown } | null }>("/api/imports", async (request, reply) => {
    const importId = randomUUID();
    const state = store.create(importId, request.body?.simulateFailure === true);
    try {
      await gateway.trigger(importId);
    } catch (error) {
      store.remove(importId);
      return reply.code(502).send({ error: messageOf(error) });
    }
    return toView(store.get(importId) ?? state);
  });

  app.get<{ Params: { id: string } }>("/api/imports/:id", async (request, reply) => {
    const state = store.get(request.params.id);
    return state ? toView(state) : reply.code(404).send();
  });

  // Called by the ImportPage command: here the web app plays the target catalog.
  app.post<{ Params: { id: string }; Body: PageRecord }>("/internal/imports/:id/pages", async (request, reply) => {
    if (store.savePage(request.params.id, request.body) === "rejected") {
      return reply.code(503).send({ error: `simulated failure on page ${SimulatedFailure.page}` });
    }
    return reply.code(204).send();
  });

  // Called by the ReportStatus command.
  app.post<{ Params: { id: string }; Body: ImportEvent }>("/internal/imports/:id/events", async (request, reply) => {
    store.apply({ ...request.body, importId: request.params.id });
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/imports/:id/stream", (request, reply) => {
    const { id } = request.params;
    const current = store.get(id);
    if (!current) return reply.code(404).send();

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (state: ImportState) => raw.write(`data: ${JSON.stringify(toView(state))}\n\n`);

    // Subscribe before sending the snapshot, so no update is lost.
    const unsubscribe = store.subscribe(id, send, () => raw.end());
    raw.on("close", unsubscribe);
    send(current);
    if (isTerminal(current.stage)) {
      unsubscribe();
      raw.end();
    }
  });

  if (staticDir) app.register(fastifyStatic, { root: staticDir });

  return app;
}

function messageOf(error: unknown): string {
  return error instanceof SkailGatewayError || error instanceof Error ? error.message : String(error);
}
