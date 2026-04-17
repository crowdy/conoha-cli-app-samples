import { randomBytes } from "node:crypto";

const envUser = process.env.ADMIN_USER ?? "";
const envPass = process.env.ADMIN_PASSWORD ?? "";
const generated = !envUser && !envPass;

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://mock:mock@localhost:5432/mock",
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  adminUser: envUser || "admin",
  adminPassword: envPass || randomBytes(12).toString("hex"),
  adminAuthGenerated: generated,
  tokenTtlSec: Number(process.env.TOKEN_TTL_SEC ?? 2592000),
  allowPrivateWebhooks:
    process.env.MOCK_ALLOW_PRIVATE_WEBHOOKS === "1" ||
    process.env.MOCK_ALLOW_PRIVATE_WEBHOOKS === "true",
};
