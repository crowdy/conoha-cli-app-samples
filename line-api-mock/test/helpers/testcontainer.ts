import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";

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
    cwd: "/home/tkim/dev/crowdy/conoha-cli-app-samples/line-api-mock",
  });
  return container;
}
