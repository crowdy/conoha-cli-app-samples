import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { richMenus, richMenuImages } from "../db/schema.js";
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

const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg"]);
const MAX_IMAGE_BYTES = 1_048_576;

richMenuRouter.post("/v2/bot/richmenu/:richMenuId/content", async (c) => {
  const id = c.req.param("richMenuId");
  const channelDbId = c.get("channelDbId");
  const contentType = c.req.header("content-type") ?? "";
  const baseMime = contentType.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_MIMES.has(baseMime)) {
    return errors.badRequest(c, "Content-Type must be image/png or image/jpeg");
  }
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    return errors.badRequest(c, "Image must be <= 1 MB");
  }

  const [row] = await db
    .select({ id: richMenus.id })
    .from(richMenus)
    .where(
      and(
        eq(richMenus.richMenuId, id),
        eq(richMenus.channelId, channelDbId)
      )
    )
    .limit(1);
  if (!row) return errors.notFound(c);

  // Upsert: delete any prior image, then insert.
  await db.delete(richMenuImages).where(eq(richMenuImages.richMenuId, row.id));
  await db.insert(richMenuImages).values({
    richMenuId: row.id,
    contentType: baseMime,
    data: buf,
  });

  return c.json({});
});

richMenuRouter.get("/v2/bot/richmenu/:richMenuId/content", async (c) => {
  const id = c.req.param("richMenuId");
  const channelDbId = c.get("channelDbId");
  const rows = await db
    .select({
      internalId: richMenus.id,
      contentType: richMenuImages.contentType,
      data: richMenuImages.data,
    })
    .from(richMenus)
    .leftJoin(richMenuImages, eq(richMenus.id, richMenuImages.richMenuId))
    .where(
      and(
        eq(richMenus.richMenuId, id),
        eq(richMenus.channelId, channelDbId)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return errors.notFound(c);
  if (!row.data || !row.contentType) return errors.notFound(c);

  c.header("Content-Type", row.contentType);
  return c.body(row.data as unknown as ArrayBuffer);
});
