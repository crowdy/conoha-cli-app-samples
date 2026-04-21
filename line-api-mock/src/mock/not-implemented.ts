import { Hono } from "hono";
import { errors } from "../lib/errors.js";

export const notImplementedRouter = new Hono();

notImplementedRouter.all("/v2/bot/audienceGroup/*", (c) =>
  errors.notImplemented(c)
);
notImplementedRouter.all("/v2/bot/insight/*", (c) => errors.notImplemented(c));
notImplementedRouter.all("/v2/bot/user/*", (c) => errors.notImplemented(c));
notImplementedRouter.all("/v2/bot/group/*", (c) => errors.notImplemented(c));
notImplementedRouter.all("/v2/bot/room/*", (c) => errors.notImplemented(c));
