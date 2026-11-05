import type { Provider } from "@skail/runtime";
import { buildConfig } from "./build-config.generated.js";
import { CatalogFunctions } from "./catalog-functions.js";
import { CatalogOperations } from "./catalog-operations.js";
import { FakeSourceCatalog, HttpSourceCatalog } from "./source.js";
import { HttpProgressNotifier, HttpTargetCatalog } from "./web.js";

// The skail bundle cannot read environment variables: these settings are fixed at build time (gen-config.mjs).
export const providers: Provider[] = [
  {
    token: CatalogFunctions,
    useFactory: () =>
      new CatalogFunctions(
        new CatalogOperations(
          buildConfig.sourceProvider === "fake"
            ? new FakeSourceCatalog()
            : new HttpSourceCatalog(buildConfig.sourceApiUrl),
          new HttpTargetCatalog(buildConfig.webBaseUrl),
          new HttpProgressNotifier(buildConfig.webBaseUrl),
        ),
      ),
  },
];
