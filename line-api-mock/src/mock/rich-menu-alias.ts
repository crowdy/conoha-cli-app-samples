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

richMenuAliasRouter.post(
  "/v2/bot/richmenu/alias",
  validate({
    requestSchema: "#/components/schemas/CreateRichMenuAliasRequest",
  }),
  async (c) => {
    const body = (await c.req.json()) as {
      richMenuAliasId: string;
      richMenuId: string;
    };
    const channelDbId = c.get("channelDbId");

    const rmInternalId = await findRichMenuInternalId(
      channelDbId,
      body.richMenuId
    );
    if (rmInternalId === null) {
      return errors.badRequest(c, "Unknown richMenuId for this channel");
    }

    const [existing] = await db
      .select({ aliasId: richMenuAliases.aliasId })
      .from(richMenuAliases)
      .where(
        and(
          eq(richMenuAliases.channelId, channelDbId),
          eq(richMenuAliases.aliasId, body.richMenuAliasId)
        )
      )
      .limit(1);
    if (existing) {
      return errors.badRequest(c, "richMenuAliasId already exists");
    }

    await db.insert(richMenuAliases).values({
      channelId: channelDbId,
      aliasId: body.richMenuAliasId,
      richMenuId: rmInternalId,
    });
    return c.json({});
  }
);
