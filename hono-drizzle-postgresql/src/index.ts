import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { initDb } from "./db/index";
import { registerRoutes } from "./routes";

// defaultHook formats zod validation failures as clean JSON instead of
// leaking the raw ZodError dump to clients.
const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        {
          message: "Validation failed",
          errors: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400
      );
    }
  },
});

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

// Global error handler — prevents raw stack traces from leaking to clients.
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ message: "Internal server error" }, 500);
});

const port = 3000;
initDb()
  .then(() => {
    serve({ fetch: app.fetch, port }, () => {
      console.log(`Server running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
