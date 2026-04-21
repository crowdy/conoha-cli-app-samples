import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { richMenus, richMenuAliases } from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { validate } from "./middleware/validate.js";
import { errors } from "../lib/errors.js";

export const richMenuAliasRouter = new Hono<{ Variables: AuthVars }>();

richMenuAliasRouter.use("/v2/bot/richmenu/alias", requestLog);
richMenuAliasRouter.use("/v2/bot/richmenu/alias", bearerAuth);
richMenuAliasRouter.use("/v2/bot/richmenu/alias/*", requestLog);
richMenuAliasRouter.use("/v2/bot/richmenu/alias/*", bearerAuth);

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
