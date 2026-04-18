import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function startDb(): Promise<StartedPostgreSqlContainer> {
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("mock")
    .withUsername("mock")
    .withPassword("mock")
    .start();
  process.env.DATABASE_URL = container.getConnectionUri();
  // Run drizzle migrations against the container.
  execSync("npx drizzle-kit push --force", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
    cwd: projectRoot,
  });
  return container;
}
