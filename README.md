# skail catalog import (Node.js)

[Português (Brasil)](README.pt-BR.md)

An app with a skail function that imports a product catalog from a public API, 20 products per page, and waits 2 seconds between pages, the rate limit of the source. Each page is a command: when a page fails, skail retries only that page, and when the app stops in the middle, the import goes on at the page where it stopped, without reading again the pages already imported. The demo imports the 194 products of [DummyJSON](https://dummyjson.com) in 10 pages. You start the import on a page the app serves at http://localhost:8080.

It shows three skail features:

- **durability**: close the app in the middle of an import, start it again and the import goes on at the page where it stopped;
- **automatic retries**: a page the target catalog rejects is retried alone, and writing it again replaces it, so nothing is duplicated;
- **a durable delay** between pages, which holds no thread or process.

## Requirements

- One of: [Docker](https://docs.docker.com/get-docker/), [Podman](https://podman.io/docs/installation) or [Node.js](https://nodejs.org) 20.12 or newer. The run script uses the first one it finds.
- A skail environment with a workload registered for the `SKAIL_WORKLOAD` in `.env` (`catalogimport:v1.0.0` by default). The [Quickstart](https://docs.skail.dev/comece-aqui/quickstart) shows how to create the account, the environment and the workload.

The project uses `@skail/runtime` and `@skail/build` **2.0.1-rc4**.

## Run

```bash
cp .env.example .env  # fill in SKAIL_SIDECAR, SKAIL_NAMESPACE and SKAIL_KEY (portal > Environments & keys > Connect)
scripts/run.sh        # then open http://localhost:8080
```

On Windows, in PowerShell: `copy .env.example .env`, then `powershell -ExecutionPolicy Bypass -File scripts\run.ps1`. The script works on the Windows PowerShell built into Windows; PowerShell 7 is not needed.

The script runs the demo with what the machine has: Docker, then Podman, then Node.js. If it finds none of them, it says what to install. Without the script, the commands are `npm install`, `npm run build` and `npm start`.

![The demo page](docs/page.png)

Each page shows up in the table as it is written to the target catalog, with the number of products, the attempts and the first products. The page refreshes itself every second, and each step is also printed to the console.

## The paths

| What you click | What happens | Result |
|---|---|---|
| **Import catalog** | 10 pages, nine of 20 products and the last of 14, 2 seconds apart | **completed**, 194 products in 10 pages |
| check **Make the target catalog reject page 3 twice**, then **Import catalog** | the target rejects the first two writes of page 3; skail retries only that page, about 15 and 30 seconds later, and the import goes on | **completed**, with 3 attempts on page 3 |

The button works again when the import ends: one import at a time.

## How it works

The app does three jobs in one process: it serves the page, it hosts the worker that runs the function (`createSkailPlatform`, with the bundle built by `npm run build`), and it starts each import through the skail HTTP API. The target catalog is simulated in the memory of the app. The commands run in an isolated VM, so they reach the target catalog over HTTP, on the app's own port under `/internal/`, as they would reach a real catalog API.

```http
POST {SKAIL_SIDECAR}/api/v1/trigger/catalogimport/v1.0.0/ImportCatalog/{importId}
["{importId}"]
```

The function and the page command, in [`src/catalog-functions.ts`](src/catalog-functions.ts):

```ts
@SkailFunction()
async ImportCatalog(importId: string): Promise<ImportResult> {
  let page = 1;
  let products = 0;
  while (true) {
    const result = await this.ImportPage(importId, page);
    products += result.imported;
    if (!result.hasMore || result.imported === 0 || page === CatalogLimits.maxPages) break;

    page++;
    await Skail.delaySeconds(CatalogLimits.secondsBetweenPages);
  }

  const result = { importId, pages: page, products };
  await this.ReportResult(result);
  return result;
}

@SkailCommand({ retryCount: 3 })
async ImportPage(importId: string, page: number): Promise<ImportedPage> {
  const read = await getSourcePage(page);
  await callApp("target", { importId, page, products: read.products });
  return { imported: read.products.length, hasMore: read.hasMore };
}
```

- `page` and `products` come only from the results of `ImportPage`. On a resume, skail runs the function again over the run history: the pages already imported return the recorded result without reading the source, and the loop goes on at the next page.
- `ImportPage` reads and writes in the same command. A retry runs both again (`@SkailCommand({ retryCount: 3 })`): the read changes nothing, and the target replaces a page written twice (the import id and the page number are the key), so nothing is duplicated.
- The products never leave the command: its result has only the number of products and whether there are more pages, so the run history stays small.
- The loop stops when the source says there is no more, when a page comes empty, or at page 50, a cap that keeps the run history bounded if the source never reports the end.

| File | What it has |
|---|---|
| `src/catalog-functions.ts` | The function and its commands. |
| `src/source.ts` | The call to DummyJSON. |
| `src/model.ts` | The limits, the products and the result of the import. |
| `src/import-desk.ts` | Starts the imports for the page and plays the target catalog. |
| `page/index.html` | The page, with the skail branding. |
| `src/skail-api.ts` | The trigger through the skail HTTP API. |
| `src/main.ts` | Reads `.env`, serves the page, its API and the target catalog, and starts the worker. |
| `scripts/build-skail.mjs` | Builds the bundle into `.skail/` for `SKAIL_WORKLOAD`; run `npm run build` again if it changes. |
| `scripts/run.sh`, `scripts/run.ps1`, `Dockerfile` | Run the demo with Docker, Podman or Node.js, whatever the machine has. |

## See the durability

1. Run `scripts/run.sh`, open the page and click **Import catalog**.
2. After a few pages, press **Ctrl+C**. The app closes; the import stays in skail.
3. Run `scripts/run.sh` again and open the page. skail hands the app the import: it goes on at the page where it stopped, without reading again the pages already imported, and ends with 194 products. The table shows the pages written after the restart; the ones before were in the memory of the app that closed. A page that was in the middle of its command when the app closed can take a few minutes to be handed out again; the import waits for it.

In the portal, open the [Monitor](https://docs.skail.dev/referencia/portal/monitor) of your environment and click the import: it lists one `ImportPage` per page, with the `Delay` between them, and the final `ReportResult`. With the checkbox on, page 3 shows its two failed attempts.

## Notes

- Apps running the same `SKAIL_WORKLOAD` on the same environment share the same runs: use one workload (or environment) per person.

## Disclaimer

**This is a demo, not production code.** It exists only to show how [skail](https://docs.skail.dev) works and is provided "as is", without warranty of any kind. It reads a free third-party API (DummyJSON) that may change, limit or refuse requests at any time, and the target catalog is simulated.

## License

[Apache-2.0](LICENSE)
