export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://mock:mock@localhost:5432/mock",
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  adminUser: process.env.ADMIN_USER ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  tokenTtlSec: Number(process.env.TOKEN_TTL_SEC ?? 2592000),
};
