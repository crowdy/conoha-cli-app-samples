import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { getMessages } from "./db";
import { wsRoutes } from "./ws";

const app = new Elysia()
  .use(staticPlugin({ prefix: "/public", assets: "public" }))
  .use(wsRoutes)
  .get("/", () => Bun.file("public/index.html"))
  .get("/api/messages", ({ query }) => {
    const limit = Number(query.limit) || 50;
    return getMessages(Math.min(limit, 200));
  })
  .get("/health", () => ({ status: "ok" }))
  .listen(3000);

console.log(`Server running on port ${app.server?.port}`);
