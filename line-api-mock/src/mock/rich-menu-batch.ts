import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { richMenus, userRichMenuLinks } from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { validate } from "./middleware/validate.js";
import { errors } from "../lib/errors.js";

export const richMenuBatchRouter = new Hono<{ Variables: AuthVars }>();

richMenuBatchRouter.use("/v2/bot/richmenu/batch", requestLog);
richMenuBatchRouter.use("/v2/bot/richmenu/batch", bearerAuth);
richMenuBatchRouter.use("/v2/bot/richmenu/validate/batch", requestLog);
richMenuBatchRouter.use("/v2/bot/richmenu/validate/batch", bearerAuth);
richMenuBatchRouter.use("/v2/bot/richmenu/progress/batch", requestLog);
richMenuBatchRouter.use("/v2/bot/richmenu/progress/batch", bearerAuth);

async function findRichMenuInternalId(
  channelDbId: number,
  richMenuIdStr: string
): Promise<number | null> {
  const [row] = await db
    .select({ id: richMenus.id })
    .from(richMenus)
    .where(
      and(
        eq(richMenus.richMenuId, richMenuIdStr),
        eq(richMenus.channelId, channelDbId)
      )
    )
    .limit(1);
  return row ? row.id : null;
}

function genRequestId(): string {
  return (
    Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  ).slice(0, 32);
}

richMenuBatchRouter.post(
  "/v2/bot/richmenu/validate/batch",
  validate({
    requestSchema: "#/components/schemas/RichMenuBatchRequest",
  }),
  async (c) => {
    const body = (await c.req.json()) as {
      operations: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(body.operations) || body.operations.length === 0) {
      return errors.badRequest(c, "operations must be a non-empty array");
    }
    return c.body(null, 200);
  }
);
