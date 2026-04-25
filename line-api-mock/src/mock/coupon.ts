import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { coupons } from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { validate } from "./middleware/validate.js";
import { couponId as makeCouponId } from "../lib/id.js";
import { errors } from "../lib/errors.js";

export const couponRouter = new Hono<{ Variables: AuthVars }>();

couponRouter.use("/v2/bot/coupon", requestLog);
couponRouter.use("/v2/bot/coupon", bearerAuth());
couponRouter.use("/v2/bot/coupon/*", requestLog);
couponRouter.use("/v2/bot/coupon/*", bearerAuth());

couponRouter.post(
  "/v2/bot/coupon",
  validate({
    requestSchema: "#/components/schemas/CouponCreateRequest",
    responseSchema: "#/components/schemas/CouponCreateResponse",
  }),
  async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const startTimestamp = body.startTimestamp as number;
    const endTimestamp = body.endTimestamp as number;

    if (startTimestamp >= endTimestamp) {
      return errors.badRequest(c, "startTimestamp must be < endTimestamp");
    }

    const channelDbId = c.get("channelDbId");
    const newId = makeCouponId();
    const createdTimestamp = Math.floor(Date.now() / 1000);

    const detail = {
      ...body,
      couponId: newId,
      createdTimestamp,
      status: "RUNNING",
    };

    await db.insert(coupons).values({
      couponId: newId,
      channelId: channelDbId,
      payload: detail,
      status: "RUNNING",
    });

    return c.json({ couponId: newId });
  }
);

couponRouter.get(
  "/v2/bot/coupon/:couponId",
  validate({ responseSchema: "#/components/schemas/CouponResponse" }),
  async (c) => {
    const couponIdParam = c.req.param("couponId");
    const channelDbId = c.get("channelDbId");
    const [row] = await db
      .select()
      .from(coupons)
      .where(
        and(
          eq(coupons.couponId, couponIdParam),
          eq(coupons.channelId, channelDbId)
        )
      )
      .limit(1);
    if (!row) return errors.notFound(c);
    const detail = { ...(row.payload as object), status: row.status };
    return c.json(detail);
  }
);

couponRouter.get(
  "/v2/bot/coupon",
  validate({ responseSchema: "#/components/schemas/MessagingApiPagerCouponListResponse" }),
  async (c) => {
    const channelDbId = c.get("channelDbId");
    const statusFilter = c.req.query("status");
    const rows = statusFilter
      ? await db
          .select({
            couponId: coupons.couponId,
            payload: coupons.payload,
          })
          .from(coupons)
          .where(
            and(
              eq(coupons.channelId, channelDbId),
              eq(coupons.status, statusFilter)
            )
          )
      : await db
          .select({
            couponId: coupons.couponId,
            payload: coupons.payload,
          })
          .from(coupons)
          .where(eq(coupons.channelId, channelDbId));

    const items = rows.map((r) => ({
      couponId: r.couponId,
      title: (r.payload as { title: string }).title,
    }));
    return c.json({ items });
  }
);

couponRouter.put("/v2/bot/coupon/:couponId/close", async (c) => {
  const couponIdParam = c.req.param("couponId");
  const channelDbId = c.get("channelDbId");
  const [row] = await db
    .select()
    .from(coupons)
    .where(
      and(
        eq(coupons.couponId, couponIdParam),
        eq(coupons.channelId, channelDbId)
      )
    )
    .limit(1);
  if (!row) return errors.notFound(c);
  if (row.status === "CLOSED") {
    return errors.badRequest(c, "Coupon is already closed");
  }
  await db
    .update(coupons)
    .set({
      status: "CLOSED",
      payload: { ...(row.payload as object), status: "CLOSED" },
    })
    .where(eq(coupons.id, row.id));
  return c.json({});
});
