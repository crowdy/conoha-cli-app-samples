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
couponRouter.use("/v2/bot/coupon", bearerAuth);
couponRouter.use("/v2/bot/coupon/*", requestLog);
couponRouter.use("/v2/bot/coupon/*", bearerAuth);

interface CouponCreateBody {
  title: string;
  description?: string;
  imageUrl?: string;
  barcodeImageUrl?: string;
  couponCode?: string;
  usageCondition?: string;
  startTimestamp: number;
  endTimestamp: number;
  maxUseCountPerTicket: number;
  timezone: string;
  visibility: string;
  acquisitionCondition: { type: string; [k: string]: unknown };
  reward: { type: string; [k: string]: unknown };
}

couponRouter.post(
  "/v2/bot/coupon",
  validate({
    requestSchema: "#/components/schemas/CouponCreateRequest",
    responseSchema: "#/components/schemas/CouponCreateResponse",
  }),
  async (c) => {
    const body = (await c.req.json()) as CouponCreateBody;

    if (body.startTimestamp >= body.endTimestamp) {
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

couponRouter.get("/v2/bot/coupon/:couponId", async (c) => {
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
});
