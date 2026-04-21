import { Hono } from "hono";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { validate } from "./middleware/validate.js";

export const validateRouter = new Hono<{ Variables: AuthVars }>();

validateRouter.use("/v2/bot/message/validate/*", requestLog);
validateRouter.use("/v2/bot/message/validate/*", bearerAuth);

const PATHS = [
  "/v2/bot/message/validate/reply",
  "/v2/bot/message/validate/push",
  "/v2/bot/message/validate/multicast",
  "/v2/bot/message/validate/narrowcast",
  "/v2/bot/message/validate/broadcast",
] as const;

for (const p of PATHS) {
  validateRouter.post(
    p,
    validate({ requestSchema: "#/components/schemas/ValidateMessageRequest" }),
    (c) => c.body(null, 200)
  );
}
