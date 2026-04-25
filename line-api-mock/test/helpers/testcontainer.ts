import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Single source of truth for the Postgres image. Used here (fallback path)
// and by postgres-global.ts (shared-container path).
export const POSTGRES_IMAGE = "postgres:17-alpine";

// Mirrors the default in src/config.ts. If process.env.DATABASE_URL is unset,
// config.ts substitutes this value — meaning a `INTEGRATION_DB_SHARED=1`
// sentinel that survived from a parent shell would silently try to connect
// here. We treat that exact string as "no real DB" and refuse to truncate.
const DEFAULT_FALLBACK_DATABASE_URL =
  "postgres://mock:mock@localhost:5432/mock";

// Suite-level handle. With the shared globalSetup container, `stop()` is a
// no-op (the container is owned by globalSetup); without it, `stop()` stops
// the per-suite container. Either way, the call sites in test files don't
// need to know which mode they're in.
export interface DbHandle {
  stop(): Promise<void>;
}

export async function startDb(): Promise<DbHandle> {
  if (process.env.INTEGRATION_DB_SHARED === "1") {
    const url = process.env.DATABASE_URL;
    if (!url || url === DEFAULT_FALLBACK_DATABASE_URL) {
      throw new Error(
        "INTEGRATION_DB_SHARED=1 is set but DATABASE_URL is missing or points " +
          "at the default fallback. The sentinel appears to be leaking from a " +
          "parent shell. Run `npm run test:integration` (which uses " +
          "vitest.integration.config.ts and provisions the shared container), " +
          "or `unset INTEGRATION_DB_SHARED` to use the per-suite-container fallback."
      );
    }
    await truncateAll();
    return { stop: async () => {} };
  }

  // Fallback for ad-hoc invocations like `npx vitest run test/integration/x.test.ts`
  // without going through the integration vitest config. Keeps the file
  // independently runnable for fast iteration.
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase("mock")
    .withUsername("mock")
    .withPassword("mock")
    .start();
  process.env.DATABASE_URL = container.getConnectionUri();
  runDrizzlePush(container.getConnectionUri());
  return wrapContainer(container);
}

function wrapContainer(c: StartedPostgreSqlContainer): DbHandle {
  return {
    stop: async () => {
      await c.stop();
    },
  };
}

async function truncateAll(): Promise<void> {
  // Lazy-import so this module stays usable in code paths that haven't
  // configured DATABASE_URL yet (e.g. importing the type alias only).
  const { sql } = await import("../../src/db/client.js");
  // Discover tables dynamically from the live schema. Hardcoding the list
  // here would silently rot whenever someone adds a table to schema.ts but
  // forgets to update this file — exactly the kind of cross-suite bleed
  // that's painful to debug. CASCADE handles FK ordering for us.
  const rows = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  if (rows.length === 0) return;
  await sql.unsafe(
    `TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`
  );
}

export function runDrizzlePush(databaseUrl: string): void {
  // Capture output and only surface it on failure so a green run doesn't
  // dump drizzle-kit chatter into the vitest reporter.
  try {
    execSync("npx drizzle-kit push --force", {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: databaseUrl },
      cwd: projectRoot,
    });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    if (e.stdout) process.stderr.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
    throw err;
  }
}
