import { defineConfig } from "vitest/config";

// Integration-test config: shares one Postgres container across all suites
// (started by `test/helpers/postgres-global.ts`) and runs in a single fork so
// suites can safely truncate the shared schema between files without racing
// each other.
//
// Wall-clock is slightly worse than the previous "one container per file in
// parallel" setup (no parallelism across files), but resource usage is
// dramatically lower — and the bot-info.test.ts flakiness observed on PR #21
// went away as soon as we stopped running 8+ Postgres containers at once on
// constrained hardware.
export default defineConfig({
  test: {
    globalSetup: [
      "./test/helpers/admin-setup.ts",
      "./test/helpers/postgres-global.ts",
    ],
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    // Plenty of headroom for the largest suite (rich-menu, ~12 s currently).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
