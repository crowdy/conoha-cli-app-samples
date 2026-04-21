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

// IMPORTANT: /alias/list must be registered BEFORE /alias/:aliasId so Hono
// doesn't capture "list" as aliasId.
richMenuAliasRouter.get(
  "/v2/bot/richmenu/alias/list",
  validate({
    responseSchema: "#/components/schemas/RichMenuAliasListResponse",
  }),
  async (c) => {
    const channelDbId = c.get("channelDbId");
    const rows = await db
      .select({
        aliasId: richMenuAliases.aliasId,
        richMenuIdStr: richMenus.richMenuId,
      })
      .from(richMenuAliases)
      .innerJoin(richMenus, eq(richMenuAliases.richMenuId, richMenus.id))
      .where(eq(richMenuAliases.channelId, channelDbId));
    return c.json({
      aliases: rows.map((r) => ({
        richMenuAliasId: r.aliasId,
        richMenuId: r.richMenuIdStr,
      })),
    });
  }
);

richMenuAliasRouter.get(
  "/v2/bot/richmenu/alias/:aliasId",
  validate({
    responseSchema: "#/components/schemas/RichMenuAliasResponse",
  }),
  async (c) => {
    const aliasId = c.req.param("aliasId");
    const channelDbId = c.get("channelDbId");
    const [row] = await db
      .select({ richMenuIdStr: richMenus.richMenuId })
      .from(richMenuAliases)
      .innerJoin(richMenus, eq(richMenuAliases.richMenuId, richMenus.id))
      .where(
        and(
          eq(richMenuAliases.channelId, channelDbId),
          eq(richMenuAliases.aliasId, aliasId)
        )
      )
      .limit(1);
    if (!row) return errors.notFound(c);
    return c.json({
      richMenuAliasId: aliasId,
      richMenuId: row.richMenuIdStr,
    });
  }
);

richMenuAliasRouter.post(
  "/v2/bot/richmenu/alias/:aliasId",
  validate({
    requestSchema: "#/components/schemas/UpdateRichMenuAliasRequest",
  }),
  async (c) => {
    const aliasId = c.req.param("aliasId");
    const channelDbId = c.get("channelDbId");
    const body = (await c.req.json()) as { richMenuId: string };

    const [existing] = await db
      .select({ aliasId: richMenuAliases.aliasId })
      .from(richMenuAliases)
      .where(
        and(
          eq(richMenuAliases.channelId, channelDbId),
          eq(richMenuAliases.aliasId, aliasId)
        )
      )
      .limit(1);
    if (!existing) {
      return errors.badRequest(c, "Unknown richMenuAliasId");
    }

    const rmInternalId = await findRichMenuInternalId(
      channelDbId,
      body.richMenuId
    );
    if (rmInternalId === null) {
      return errors.badRequest(c, "Unknown richMenuId for this channel");
    }

    await db
      .update(richMenuAliases)
      .set({ richMenuId: rmInternalId })
      .where(
        and(
          eq(richMenuAliases.channelId, channelDbId),
          eq(richMenuAliases.aliasId, aliasId)
        )
      );
    return c.json({});
  }
);
