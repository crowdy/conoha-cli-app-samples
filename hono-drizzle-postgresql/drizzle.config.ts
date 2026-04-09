// drizzle-kit config for schema migrations.
//
// This sample keeps things simple by creating the table at startup with raw
// SQL (see src/db/index.ts). The config below is provided so you can switch to
// proper migration management whenever you need it:
//
//   npx drizzle-kit generate   # generate SQL migration from schema.ts
//   npx drizzle-kit migrate    # apply pending migrations
//
// Once you start using migrations, replace the initDb() call in src/db/index.ts
// with `migrate(db, { migrationsFolder: "./drizzle" })` from
// "drizzle-orm/postgres-js/migrator".
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/app",
  },
});
