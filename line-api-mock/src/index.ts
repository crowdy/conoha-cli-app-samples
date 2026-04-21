import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { seedIfEmpty } from "./db/seed.js";
import { oauthRouter } from "./mock/oauth.js";
import { oauthV3Router } from "./mock/oauth-v3.js";
import { messageRouter } from "./mock/message.js";
import { quotaRouter } from "./mock/quota.js";
import { profileRouter } from "./mock/profile.js";
import { webhookEndpointRouter } from "./mock/webhook-endpoint.js";
import { contentRouter } from "./mock/content.js";
import { couponRouter } from "./mock/coupon.js";
import { validateRouter } from "./mock/validate.js";
import { botInfoRouter } from "./mock/bot-info.js";
import { richMenuRouter } from "./mock/rich-menu.js";
import { richMenuLinkRouter } from "./mock/rich-menu-link.js";
import { richMenuAliasRouter } from "./mock/rich-menu-alias.js";
import { notImplementedRouter } from "./mock/not-implemented.js";
import { adminRouter } from "./admin/routes.js";

const app = new Hono();
app.route("/", oauthRouter);
app.route("/", oauthV3Router);
app.route("/", messageRouter);
app.route("/", quotaRouter);
app.route("/", profileRouter);
app.route("/", webhookEndpointRouter);
app.route("/", contentRouter);
app.route("/", couponRouter);
app.route("/", validateRouter);
app.route("/", botInfoRouter);
app.route("/", richMenuRouter);
app.route("/", richMenuLinkRouter);
app.route("/", richMenuAliasRouter);
app.route("/", adminRouter);
app.route("/", notImplementedRouter);

app.get("/health", (c) => c.json({ status: "ok" }));

const specPath = resolve(process.cwd(), "specs/messaging-api.yml");
const specYaml = readFileSync(specPath, "utf8");

app.get("/openapi.yaml", (c) => {
  c.header("Content-Type", "application/yaml");
  return c.body(specYaml);
});

// Swagger UI via CDN, loading /openapi.yaml.
app.get("/docs", (c) =>
  c.html(`<!doctype html>
<html>
<head>
  <title>LINE API Mock — Swagger UI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      SwaggerUIBundle({ url: "/openapi.yaml", dom_id: "#swagger" });
    };
  </script>
</body>
</html>`)
);

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ message: "Internal server error" }, 500);
});

async function main() {
  await runMigrations();
  await seedIfEmpty();
  if (config.adminAuthGenerated) {
    console.log("[line-api-mock] Admin auth (generated — set ADMIN_USER/ADMIN_PASSWORD env vars to override):");
    console.log(`  admin_user:     ${config.adminUser}`);
    console.log(`  admin_password: ${config.adminPassword}`);
  } else {
    console.log("[line-api-mock] Admin auth: from ADMIN_USER/ADMIN_PASSWORD env vars");
  }
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`[line-api-mock] listening on :${info.port}`);
    console.log(`  Admin:      ${config.appBaseUrl}/admin`);
    console.log(`  Swagger UI: ${config.appBaseUrl}/docs`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
