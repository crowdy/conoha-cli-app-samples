import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { richMenus, userRichMenuLinks } from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { validate } from "./middleware/validate.js";
import { errors } from "../lib/errors.js";
import { findRichMenuInternalId } from "../lib/rich-menu.js";

export const richMenuBatchRouter = new Hono<{ Variables: AuthVars }>();

richMenuBatchRouter.use("/v2/bot/richmenu/batch", requestLog);
richMenuBatchRouter.use("/v2/bot/richmenu/batch", bearerAuth);
richMenuBatchRouter.use("/v2/bot/richmenu/validate/batch", requestLog);
richMenuBatchRouter.use("/v2/bot/richmenu/validate/batch", bearerAuth);
richMenuBatchRouter.use("/v2/bot/richmenu/progress/batch", requestLog);
richMenuBatchRouter.use("/v2/bot/richmenu/progress/batch", bearerAuth);

function genRequestId(): string {
  return (
    Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  )
    .padEnd(32, "0")
    .slice(0, 32);
}

// ajv's discriminator wiring only enforces the `type` enum — not the
// variant-specific required fields (`from`/`to` on link, `from` on unlink).
// Real LINE rejects these with 400, so we gate them in the handler.
function invalidBatchOperation(
  op: Record<string, unknown>
): string | null {
  if (op.type === "link") {
    if (typeof op.from !== "string" || typeof op.to !== "string") {
      return "link operation requires `from` and `to` strings";
    }
    return null;
  }
  if (op.type === "unlink") {
    if (typeof op.from !== "string") {
      return "unlink operation requires `from` string";
    }
    return null;
  }
  if (op.type === "unlinkAll") {
    return null;
  }
  return `unknown operation type: ${String(op.type)}`;
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
    for (const op of body.operations) {
      const err = invalidBatchOperation(op as Record<string, unknown>);
      if (err) return errors.badRequest(c, err);
    }
    return c.body(null, 200);
  }
);

type LinkOp = { type: "link"; from: string; to: string };
type UnlinkOp = { type: "unlink"; from: string };
type UnlinkAllOp = { type: "unlinkAll" };
type BatchOp = LinkOp | UnlinkOp | UnlinkAllOp;

richMenuBatchRouter.post(
  "/v2/bot/richmenu/batch",
  validate({
    requestSchema: "#/components/schemas/RichMenuBatchRequest",
  }),
  async (c) => {
    const body = (await c.req.json()) as { operations: BatchOp[] };
    if (!Array.isArray(body.operations) || body.operations.length === 0) {
      return errors.badRequest(c, "operations must be a non-empty array");
    }
    for (const op of body.operations) {
      const err = invalidBatchOperation(op as Record<string, unknown>);
      if (err) return errors.badRequest(c, err);
    }
    const channelDbId = c.get("channelDbId");

    for (const op of body.operations) {
      if (op.type === "unlinkAll") {
        await db
          .delete(userRichMenuLinks)
          .where(eq(userRichMenuLinks.channelId, channelDbId));
        continue;
      }
      if (op.type === "unlink") {
        const fromId = await findRichMenuInternalId(channelDbId, op.from);
        if (fromId === null) continue;
        await db
          .delete(userRichMenuLinks)
          .where(
            and(
              eq(userRichMenuLinks.channelId, channelDbId),
              eq(userRichMenuLinks.richMenuId, fromId)
            )
          );
        continue;
      }
      if (op.type === "link") {
        const fromId = await findRichMenuInternalId(channelDbId, op.from);
        const toId = await findRichMenuInternalId(channelDbId, op.to);
        if (fromId === null || toId === null) continue;
        await db
          .update(userRichMenuLinks)
          .set({ richMenuId: toId })
          .where(
            and(
              eq(userRichMenuLinks.channelId, channelDbId),
              eq(userRichMenuLinks.richMenuId, fromId)
            )
          );
        continue;
      }
    }

    c.header("X-Line-Request-Id", genRequestId());
    return c.body(null, 202);
  }
);

richMenuBatchRouter.get(
  "/v2/bot/richmenu/progress/batch",
  validate({
    responseSchema: "#/components/schemas/RichMenuBatchProgressResponse",
  }),
  async (c) => {
    if (!c.req.query("requestId")) {
      return errors.badRequest(c, "requestId is required");
    }
    // Wire format is ISO 8601 string; @line/bot-sdk types declare `Date` but
    // the generated deserializer does not coerce. See issue #34 (M2) and the
    // SDK-compat pin in test/sdk-compat/rich-menu-batch-progress.test.ts.
    const now = new Date().toISOString();
    return c.json({
      phase: "succeeded",
      acceptedTime: now,
      completedTime: now,
    });
  }
);
