import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./client.js";

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: "./drizzle" });
}
