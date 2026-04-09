import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL || "postgres://postgres:postgres@db:5432/app";
const client = postgres(connectionString);
export const db = drizzle(client, { schema });

export async function initDb() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      tags TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}
