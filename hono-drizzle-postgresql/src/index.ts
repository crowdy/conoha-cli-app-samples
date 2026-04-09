import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { initDb } from "./db/index";
import { registerRoutes } from "./routes";

const app = new OpenAPIHono();

registerRoutes(app);

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Bookmark API",
    description: "Bookmark management API built with Hono + Drizzle + PostgreSQL",
    version: "1.0.0",
  },
});

app.get("/doc", swaggerUI({ url: "/openapi.json" }));

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/", serveStatic({ path: "./public/index.html" }));

const port = 3000;
initDb().then(() => {
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on port ${port}`);
  });
});
