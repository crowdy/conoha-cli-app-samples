import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { errors } from "../../src/lib/errors.js";

describe("errors helper", () => {
  it("unauthorized returns LINE-format 401 body", async () => {
    const app = new Hono();
    app.get("/x", (c) => errors.unauthorized(c));
    const res = await app.request("/x");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      message: "Authentication failed due to the expired access token",
    });
  });

  it("badRequest attaches details", async () => {
    const app = new Hono();
    app.get("/x", (c) =>
      errors.badRequest(c, "The property, 'to' must be specified.", [
        { message: "to required", property: "to" },
      ])
    );
    const res = await app.request("/x");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: "The property, 'to' must be specified.",
      details: [{ message: "to required", property: "to" }],
    });
  });
});
