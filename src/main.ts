import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createSkailPlatform } from "@skail/runtime";
import { ImportDesk, TargetRejected } from "./import-desk.js";
import { SkailApiClient, skailApiOptionsFromEnvironment } from "./skail-api.js";

// usage: npm start
//   then open http://localhost:8080
if (process.argv.slice(2).some((a) => !a.startsWith("-"))) {
  console.error("This demo takes no arguments.");
  process.exit(1);
}

loadDotEnv();
const missing = ["SKAIL_WORKLOAD", "SKAIL_NAMESPACE", "SKAIL_KEY", "SKAIL_SIDECAR"].filter(
  (n) => !process.env[n]?.trim(),
);
if (missing.length > 0) {
  console.error(`Missing ${missing.join(", ")}. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}

const desk = new ImportDesk(new SkailApiClient(skailApiOptionsFromEnvironment()));

const page = readFileSync(new URL("../page/index.html", import.meta.url));
const port = Number(process.env.DEMO_PORT ?? 8080);
// the page: localhost only, unless DEMO_HOST says otherwise (the container listens on all interfaces)
const host = process.env.DEMO_HOST ?? "127.0.0.1";

// the page, its API, and under /internal/ the target catalog, which the commands call
const server = createServer(async (request, response) => {
  const send = (status: number, body?: unknown) =>
    response
      .writeHead(status, { "content-type": "application/json" })
      .end(body === undefined ? "" : JSON.stringify(body));
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/")
      return void response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
    if (request.method === "GET" && url.pathname === "/api/state") return send(200, desk.view());

    if (request.method === "POST" && url.pathname === "/api/imports")
      return send((await desk.start(url.searchParams.get("rejectPage3") === "true")) ? 200 : 409);

    if (request.method === "POST" && url.pathname.startsWith("/internal/")) {
      let body = "";
      for await (const chunk of request) body += chunk;
      const data = JSON.parse(body);
      if (url.pathname === "/internal/target") {
        desk.savePage(data.importId, data.page, data.products);
        return send(200);
      }
      if (url.pathname === "/internal/result") {
        desk.completed(data);
        return send(200);
      }
    }
    send(404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof TargetRejected)) console.error(message);
    response.writeHead(error instanceof TargetRejected ? 503 : 500).end(message);
  }
});
await new Promise<void>((resolve) => server.listen(port, host, resolve));

// the commands run in an isolated VM and call the app over HTTP; the address goes in the environment before the worker
// starts
process.env.DEMO_INTERNAL_URL = `http://127.0.0.1:${port}`;

// hosts the worker that executes CatalogFunctions (the bundle from `npm run build`);
// reads SKAIL_WORKLOAD, SKAIL_NAMESPACE, SKAIL_KEY and SKAIL_SIDECAR from the environment
const platform = createSkailPlatform({
  bundle: new URL("../.skail/skail-functions.mjs", import.meta.url),
  manifest: new URL("../.skail/manifest.json", import.meta.url),
});

const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    shutdown.abort();
  });
}
const worker = platform.run(shutdown.signal);
console.log(`Open http://localhost:${port} to import the catalog. Ctrl+C exits; an import in the middle goes on in skail.`);
await worker;

/** Loads .env from the current directory, when present. Variables already set in the environment win. */
function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
