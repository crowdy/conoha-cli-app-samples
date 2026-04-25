import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Vitest globalSetup: spin up ONE Postgres container for the entire
// integration-test run. Each suite's `beforeAll` (via startDb()) re-uses this
// container and just truncates the schema, instead of paying the ~3-5 s
// container-start + drizzle-kit-push tax 14 times.
//
// Pre-batch-4 numbers on a clean run: 14 × ~4 s ≈ 56 s of pure setup, plus
// memory pressure from 8+ simultaneous Postgres containers competing for
// shared memory (which is what made bot-info.test.ts flaky on PR #21).

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.."
);

let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("mock")
    .withUsername("mock")
    .withPassword("mock")
    .start();
  const url = container.getConnectionUri();
  // Both env vars are inherited by the test worker (we use singleFork, so
  // there is exactly one) and read by src/config.ts on first import.
  process.env.DATABASE_URL = url;
  // Sentinel that startDb() checks to decide whether to start its own
  // container (legacy / ad-hoc `vitest run <file>`) or just truncate the
  // shared one.
  process.env.INTEGRATION_DB_SHARED = "1";

  execSync("npx drizzle-kit push --force", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
    cwd: projectRoot,
  });
}

export async function teardown(): Promise<void> {
  if (container) {
    await container.stop();
    container = undefined;
  }
}
