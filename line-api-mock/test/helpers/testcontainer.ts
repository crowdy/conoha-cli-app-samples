import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Listed parent-first; CASCADE on TRUNCATE follows FKs from here.
const TRUNCATE_TABLES = [
  "channels",
  "access_tokens",
  "virtual_users",
  "channel_friends",
  "messages",
  "message_contents",
  "webhook_deliveries",
  "api_logs",
  "coupons",
  "rich_menus",
  "rich_menu_images",
  "user_rich_menu_links",
  "rich_menu_aliases",
];

// Suite-level handle. With the shared globalSetup container, `stop()` is a
// no-op (the container is owned by globalSetup); without it, `stop()` stops
// the per-suite container. Either way, the call sites in test files don't
// need to know which mode they're in.
export interface DbHandle {
  stop(): Promise<void>;
}

export async function startDb(): Promise<DbHandle> {
  if (process.env.INTEGRATION_DB_SHARED === "1") {
    await truncateAll();
    return { stop: async () => {} };
  }

  // Fallback for ad-hoc invocations like `npx vitest run test/integration/x.test.ts`
  // without going through the integration vitest config. Keeps the file
  // independently runnable for fast iteration.
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("mock")
    .withUsername("mock")
    .withPassword("mock")
    .start();
  process.env.DATABASE_URL = container.getConnectionUri();
  execSync("npx drizzle-kit push --force", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
    cwd: projectRoot,
  });
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
  await sql.unsafe(
    `TRUNCATE TABLE ${TRUNCATE_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`
  );
}
