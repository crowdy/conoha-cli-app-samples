import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { richMenus } from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { validate } from "./middleware/validate.js";
import { richMenuId as makeRichMenuId } from "../lib/id.js";
import { errors } from "../lib/errors.js";

export const richMenuRouter = new Hono<{ Variables: AuthVars }>();

richMenuRouter.use("/v2/bot/richmenu", requestLog);
richMenuRouter.use("/v2/bot/richmenu", bearerAuth);
richMenuRouter.use("/v2/bot/richmenu/*", requestLog);
richMenuRouter.use("/v2/bot/richmenu/*", bearerAuth);

const RICH_MENU_REQUIRED = ["size", "selected", "name", "chatBarText", "areas"] as const;

richMenuRouter.post(
  "/v2/bot/richmenu",
  validate({
    requestSchema: "#/components/schemas/RichMenuRequest",
    responseSchema: "#/components/schemas/RichMenuIdResponse",
  }),
  async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    for (const field of RICH_MENU_REQUIRED) {
      if (!(field in body)) {
        return errors.badRequest(c, `Missing required field: ${field}`);
      }
    }
    const channelDbId = c.get("channelDbId");
    const newId = makeRichMenuId();

    const detail = { ...body, richMenuId: newId };

    await db.insert(richMenus).values({
      richMenuId: newId,
      channelId: channelDbId,
      payload: detail,
    });

    return c.json({ richMenuId: newId });
  }
);

richMenuRouter.post(
  "/v2/bot/richmenu/validate",
  validate({ requestSchema: "#/components/schemas/RichMenuRequest" }),
  async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    for (const field of RICH_MENU_REQUIRED) {
      if (!(field in body)) {
        return errors.badRequest(c, `Missing required field: ${field}`);
      }
    }
    return c.body(null, 200);
  }
);

richMenuRouter.get(
  "/v2/bot/richmenu/list",
  validate({ responseSchema: "#/components/schemas/RichMenuListResponse" }),
  async (c) => {
    const channelDbId = c.get("channelDbId");
    const rows = await db
      .select({ payload: richMenus.payload })
      .from(richMenus)
      .where(eq(richMenus.channelId, channelDbId));
    return c.json({ richmenus: rows.map((r) => r.payload as object) });
  }
);

richMenuRouter.get(
  "/v2/bot/richmenu/:richMenuId",
  validate({ responseSchema: "#/components/schemas/RichMenuResponse" }),
  async (c) => {
    const id = c.req.param("richMenuId");
    const channelDbId = c.get("channelDbId");
    const [row] = await db
      .select({ payload: richMenus.payload })
      .from(richMenus)
      .where(
        and(
          eq(richMenus.richMenuId, id),
          eq(richMenus.channelId, channelDbId)
        )
      )
      .limit(1);
    if (!row) return errors.notFound(c);
    return c.json(row.payload as object);
  }
);

richMenuRouter.delete("/v2/bot/richmenu/:richMenuId", async (c) => {
  const id = c.req.param("richMenuId");
  const channelDbId = c.get("channelDbId");
  const result = await db
    .delete(richMenus)
    .where(
      and(
        eq(richMenus.richMenuId, id),
        eq(richMenus.channelId, channelDbId)
      )
    )
    .returning({ id: richMenus.id });
  if (result.length === 0) return errors.notFound(c);
  return c.json({});
});
