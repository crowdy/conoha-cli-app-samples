import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config";

// SDK-compat config: shares one Postgres container across the suite (started
// by `test/helpers/postgres-global.ts`) and runs in a single fork so the
// shared schema can be reset between files without cross-suite races.
//
// Mirrors `vitest.integration.config.ts`. We deliberately use a *separate*
// config (not a single shared one) so that running test:sdk and
// test:integration concurrently each gets its own container — they reset
// the schema, which would clobber each other if they shared.
export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      globalSetup: ["./test/helpers/postgres-global.ts"],
      pool: "forks",
      poolOptions: {
        forks: { singleFork: true },
      },
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  })
);
