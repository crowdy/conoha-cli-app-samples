# line-api-mock Coupon Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement LINE Messaging API's coupon endpoints (added by LINE 2025-08) in `line-api-mock`, including `type: "coupon"` message support and admin UI.

**Architecture:** Store full `CouponResponse` payload as `jsonb` in a new `coupons` table, with `status` as a separate column for indexable filtering. Mount a dedicated Hono router (`src/mock/coupon.ts`) for the four coupon endpoints. Extend the existing `bearerAuth` + ajv validation patterns unchanged. Add a new admin UI page reusing the existing HTMX/Tailwind conventions.

**Tech Stack:** TypeScript, Hono, Drizzle ORM (PostgreSQL 17), ajv, HTMX + Tailwind, vitest, testcontainers, @line/bot-sdk (for compat tests).

**All work runs from `line-api-mock/` directory unless explicitly stated.**

---

## File Structure

**New files:**
- `src/mock/coupon.ts` — router + 4 handlers (POST/GET/GET-by-id/PUT-close)
- `src/admin/pages/Coupons.tsx` — admin UI page for coupon management
- `test/unit/coupon-schema.test.ts` — ajv schema validation
- `test/unit/coupon-id.test.ts` — ID generator
- `test/integration/coupon.test.ts` — end-to-end API flow
- `test/sdk-compat/coupon.test.ts` — @line/bot-sdk raw push with coupon message type
- `drizzle/0001_*.sql` — auto-generated migration (name will vary)

**Modified files:**
- `src/db/schema.ts` — append `coupons` table definition
- `src/lib/id.ts` — add `couponId()` helper
- `src/mock/message.ts` — validate `couponId` existence in `insertBotMessages`
- `src/index.ts` — mount coupon router
- `src/admin/routes.tsx` — register coupons admin routes + queries
- `src/admin/pages/Layout.tsx` — add Coupons nav link
- `src/admin/pages/Conversation.tsx` — render `type:"coupon"` messages as cards
- `README.md` — move coupon entries from "未実装" to "実装済み"

---

## Task 1: Add `coupons` table to Drizzle schema

**Files:**
- Modify: `src/db/schema.ts` (append new table after existing tables)

- [ ] **Step 1: Add table definition**

Edit `src/db/schema.ts` — append this block at the end of the file, after the `apiLogs` table:

```ts
export const coupons = pgTable("coupons", {
  id: serial("id").primaryKey(),
  couponId: text("coupon_id").notNull().unique(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("RUNNING"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

All imports (`pgTable`, `serial`, `text`, `integer`, `jsonb`, `timestamp`) are already in the file.

- [ ] **Step 2: Generate migration**

Run: `npm run db:generate`
Expected: a new file like `drizzle/0001_<adjective>_<noun>.sql` is created and `drizzle/meta/_journal.json` is updated.

- [ ] **Step 3: Verify migration SQL**

Run: `cat drizzle/0001_*.sql` (use the specific file just created)

Expected output should contain:
- `CREATE TABLE "coupons"`
- `"coupon_id" text NOT NULL`
- `"channel_id" integer NOT NULL`
- `"payload" jsonb NOT NULL`
- `"status" text DEFAULT 'RUNNING' NOT NULL`
- A UNIQUE constraint on `coupon_id`
- A FOREIGN KEY referencing `channels(id)` with `ON DELETE cascade`

If any clause is missing, inspect the generated SQL and adjust the schema definition, then regenerate.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/0001_*.sql drizzle/meta/
git commit -m "feat(line-api-mock): add coupons table schema"
```

---

## Task 2: Add `couponId()` generator

**Files:**
- Modify: `src/lib/id.ts`
- Create: `test/unit/coupon-id.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/coupon-id.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { couponId } from "../../src/lib/id.js";

describe("couponId()", () => {
  it("returns a string starting with COUPON_", () => {
    expect(couponId()).toMatch(/^COUPON_/);
  });

  it("contains base64url body (no +/=)", () => {
    const id = couponId();
    const body = id.replace(/^COUPON_/, "");
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(body.length).toBeGreaterThanOrEqual(16);
  });

  it("is unique across many calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(couponId());
    expect(set.size).toBe(1000);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npm run test:unit -- test/unit/coupon-id.test.ts`
Expected: FAIL with import error (`couponId` is not exported).

- [ ] **Step 3: Implement**

Edit `src/lib/id.ts` — add this function at the bottom:

```ts
export function couponId(): string {
  return "COUPON_" + randomBytes(16).toString("base64url");
}
```

The `randomBytes` import at the top of the file is already present.

- [ ] **Step 4: Run the test — expect pass**

Run: `npm run test:unit -- test/unit/coupon-id.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/id.ts test/unit/coupon-id.test.ts
git commit -m "feat(line-api-mock): add couponId() generator"
```

---

## Task 3: Coupon schema validation (unit)

**Files:**
- Create: `test/unit/coupon-schema.test.ts`

This task verifies the ajv middleware + vendored OpenAPI spec correctly enforce `CouponCreateRequest`. No production code changes — this confirms the spec-driven validation works for coupons.

- [ ] **Step 1: Write the test**

Create `test/unit/coupon-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import Ajv, { type AnySchema } from "ajv";
import addFormats from "ajv-formats";
import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type OpenApiSpec = {
  components?: { schemas?: Record<string, unknown> };
};

const spec = yaml.load(
  readFileSync(resolve(process.cwd(), "specs/messaging-api.yml"), "utf8")
) as OpenApiSpec;

function rewriteRefs(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(rewriteRefs);
  if (s && typeof s === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
      o[k] = k === "$ref" && typeof v === "string" ? v : rewriteRefs(v);
    }
    return o;
  }
  return s;
}

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
for (const [name, s] of Object.entries(spec.components!.schemas!)) {
  ajv.addSchema(rewriteRefs(s) as AnySchema, `#/components/schemas/${name}`);
}
const validate = ajv.getSchema("#/components/schemas/CouponCreateRequest")!;

function base() {
  return {
    title: "Summer Sale",
    startTimestamp: 1_700_000_000,
    endTimestamp: 1_800_000_000,
    maxUseCountPerTicket: 1,
    timezone: "ASIA_TOKYO",
    visibility: "UNLISTED",
    acquisitionCondition: { type: "normal" },
    reward: {
      type: "discount",
      priceInfo: { type: "percentage", percentage: 10 },
    },
  };
}

describe("CouponCreateRequest schema", () => {
  it("accepts a minimal valid payload", () => {
    expect(validate(base())).toBe(true);
  });

  it("rejects missing title", () => {
    const p: any = base();
    delete p.title;
    expect(validate(p)).toBe(false);
  });

  it("rejects unknown timezone enum value", () => {
    const p: any = base();
    p.timezone = "ASIA_SEOUL";
    expect(validate(p)).toBe(false);
  });

  it("rejects maxUseCountPerTicket > 1", () => {
    const p: any = base();
    p.maxUseCountPerTicket = 5;
    expect(validate(p)).toBe(false);
  });

  it("rejects title longer than 60 chars", () => {
    const p: any = base();
    p.title = "x".repeat(61);
    expect(validate(p)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- test/unit/coupon-schema.test.ts`
Expected: all 5 tests PASS on first run (spec already contains `CouponCreateRequest`; we're just sanity-checking ajv accepts/rejects correctly).

If a test fails, the failure will indicate an unexpected spec shape. Investigate the spec at `specs/messaging-api.yml` around line 5264 before changing the test.

- [ ] **Step 3: Commit**

```bash
git add test/unit/coupon-schema.test.ts
git commit -m "test(line-api-mock): verify CouponCreateRequest schema enforcement"
```

---

## Task 4: Coupon router — POST create + GET by id

**Files:**
- Create: `src/mock/coupon.ts`
- Modify: `src/index.ts`
- Create: `test/integration/coupon.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `test/integration/coupon.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startDb } from "../helpers/testcontainer.js";

let container: StartedPostgreSqlContainer;
let app: any;
let token: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { couponRouter } = await import("../../src/mock/coupon.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens } = await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9100000001",
      channelSecret: randomHex(16),
      name: "Coupon Test",
    })
    .returning();
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  app = new Hono();
  app.route("/", couponRouter);
}, 60_000);

afterAll(async () => container.stop());

function validPayload() {
  return {
    title: "10% OFF",
    description: "summer only",
    startTimestamp: Math.floor(Date.now() / 1000),
    endTimestamp: Math.floor(Date.now() / 1000) + 30 * 86400,
    maxUseCountPerTicket: 1,
    timezone: "ASIA_TOKYO",
    visibility: "UNLISTED",
    acquisitionCondition: { type: "normal" },
    reward: {
      type: "discount",
      priceInfo: { type: "percentage", percentage: 10 },
    },
  };
}

describe("POST /v2/bot/coupon", () => {
  it("creates a coupon and returns couponId", async () => {
    const res = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validPayload()),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.couponId).toBe("string");
    expect(json.couponId).toMatch(/^COUPON_/);
  });

  it("rejects missing bearer token", async () => {
    const res = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validPayload()),
    });
    expect(res.status).toBe(401);
  });

  it("rejects invalid schema (missing title)", async () => {
    const p: any = validPayload();
    delete p.title;
    const res = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(p),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v2/bot/coupon/{couponId}", () => {
  it("returns coupon detail after creation", async () => {
    const createRes = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validPayload()),
    });
    const { couponId } = await createRes.json();

    const res = await app.request(`/v2/bot/coupon/${couponId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.couponId).toBe(couponId);
    expect(detail.title).toBe("10% OFF");
    expect(detail.status).toBe("RUNNING");
    expect(detail.reward.type).toBe("discount");
    expect(typeof detail.createdTimestamp).toBe("number");
  });

  it("returns 404 for unknown couponId", async () => {
    const res = await app.request("/v2/bot/coupon/COUPON_notfound", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npm run test:integration -- test/integration/coupon.test.ts`
Expected: FAIL with import error (no `couponRouter` exported from `src/mock/coupon.js`).

- [ ] **Step 3: Create the coupon router**

Create `src/mock/coupon.ts`:

```ts
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
  // payload already contains the current status, but keep columns authoritative.
  const detail = { ...(row.payload as object), status: row.status };
  return c.json(detail);
});
```

- [ ] **Step 4: Mount the router in `src/index.ts`**

Edit `src/index.ts` — add the import near the other mock imports:

```ts
import { couponRouter } from "./mock/coupon.js";
```

And add the mount **before** `notImplementedRouter` (mount order matters — specific before wildcard):

```ts
app.route("/", couponRouter);
```

Final `app.route` block should look like:
```ts
app.route("/", oauthRouter);
app.route("/", oauthV3Router);
app.route("/", messageRouter);
app.route("/", quotaRouter);
app.route("/", profileRouter);
app.route("/", webhookEndpointRouter);
app.route("/", contentRouter);
app.route("/", couponRouter);
app.route("/", adminRouter);
app.route("/", notImplementedRouter);
```

- [ ] **Step 5: Run the test — expect pass**

Run: `npm run test:integration -- test/integration/coupon.test.ts`
Expected: 3 POST tests + 2 GET tests PASS (5 total).

- [ ] **Step 6: Commit**

```bash
git add src/mock/coupon.ts src/index.ts test/integration/coupon.test.ts
git commit -m "feat(line-api-mock): implement POST/GET /v2/bot/coupon endpoints"
```

---

## Task 5: Coupon router — GET list + PUT close

**Files:**
- Modify: `src/mock/coupon.ts`
- Modify: `test/integration/coupon.test.ts`

- [ ] **Step 1: Append list + close tests**

Append the following to `test/integration/coupon.test.ts` (below the `GET /v2/bot/coupon/{couponId}` describe block):

```ts
describe("GET /v2/bot/coupon (list)", () => {
  it("returns items with couponId and title", async () => {
    const create = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validPayload(), title: "List me" }),
    });
    expect(create.status).toBe(200);

    const res = await app.request("/v2/bot/coupon", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    const found = body.items.find((i: any) => i.title === "List me");
    expect(found).toBeDefined();
    expect(typeof found.couponId).toBe("string");
  });

  it("filters by status query", async () => {
    const res = await app.request("/v2/bot/coupon?status=CLOSED", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    for (const i of body.items) {
      // None of the items created above are CLOSED yet.
      expect(i.title).not.toBe("List me");
    }
  });
});

describe("PUT /v2/bot/coupon/{couponId}/close", () => {
  it("closes a RUNNING coupon and returns 200", async () => {
    const create = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validPayload(), title: "to close" }),
    });
    const { couponId } = await create.json();

    const closeRes = await app.request(
      `/v2/bot/coupon/${couponId}/close`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
      }
    );
    expect(closeRes.status).toBe(200);

    const detailRes = await app.request(`/v2/bot/coupon/${couponId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const detail = await detailRes.json();
    expect(detail.status).toBe("CLOSED");
  });

  it("rejects double-close with 400", async () => {
    const create = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validPayload(), title: "double close" }),
    });
    const { couponId } = await create.json();

    await app.request(`/v2/bot/coupon/${couponId}/close`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
    });
    const second = await app.request(
      `/v2/bot/coupon/${couponId}/close`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
      }
    );
    expect(second.status).toBe(400);
  });

  it("returns 404 for unknown couponId", async () => {
    const res = await app.request("/v2/bot/coupon/COUPON_missing/close", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `npm run test:integration -- test/integration/coupon.test.ts`
Expected: FAIL — list returns 404 (no handler), close returns 404.

- [ ] **Step 3: Implement list and close**

Append to `src/mock/coupon.ts` (below existing handlers):

```ts
couponRouter.get("/v2/bot/coupon", async (c) => {
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
});

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
```

- [ ] **Step 4: Run all coupon tests**

Run: `npm run test:integration -- test/integration/coupon.test.ts`
Expected: all tests PASS (original 5 + new 5 = 10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mock/coupon.ts test/integration/coupon.test.ts
git commit -m "feat(line-api-mock): implement GET list + PUT close for coupons"
```

---

## Task 6: Validate `type:"coupon"` messages against known coupons

**Files:**
- Modify: `src/mock/message.ts`
- Modify: `test/integration/coupon.test.ts`

- [ ] **Step 1: Append test for coupon message validation**

Append to `test/integration/coupon.test.ts`:

```ts
describe("POST /v2/bot/message/push with coupon message", () => {
  let botUserId: string;

  beforeAll(async () => {
    const { db } = await import("../../src/db/client.js");
    const { channels, virtualUsers, channelFriends, accessTokens } =
      await import("../../src/db/schema.js");
    const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");
    const { messageRouter } = await import("../../src/mock/message.js");

    const [ch] = await db
      .insert(channels)
      .values({
        channelId: "9100000002",
        channelSecret: randomHex(16),
        name: "Coupon Message Test",
      })
      .returning();
    const msgToken = accessTokenStr();
    await db.insert(accessTokens).values({
      channelId: ch.id,
      token: msgToken,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });
    botUserId = "U" + randomHex(16);
    const [u] = await db
      .insert(virtualUsers)
      .values({ userId: botUserId, displayName: "Coupon recipient" })
      .returning();
    await db
      .insert(channelFriends)
      .values({ channelId: ch.id, userId: u.id });

    app.route("/", messageRouter);

    // Create a coupon on this channel and stash its id.
    const createRes = await app.request("/v2/bot/coupon", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${msgToken}`,
      },
      body: JSON.stringify({ ...validPayload(), title: "pushable" }),
    });
    const { couponId: realCouponId } = await createRes.json();

    // Stash on the describe's closure.
    (globalThis as any).__couponMsgCtx = { msgToken, botUserId, realCouponId };
  });

  it("accepts a push with a valid coupon message", async () => {
    const { msgToken, botUserId, realCouponId } = (globalThis as any)
      .__couponMsgCtx;
    const res = await app.request("/v2/bot/message/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${msgToken}`,
      },
      body: JSON.stringify({
        to: botUserId,
        messages: [{ type: "coupon", couponId: realCouponId }],
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sentMessages).toHaveLength(1);
  });

  it("rejects a push with an unknown couponId", async () => {
    const { msgToken, botUserId } = (globalThis as any).__couponMsgCtx;
    const res = await app.request("/v2/bot/message/push", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${msgToken}`,
      },
      body: JSON.stringify({
        to: botUserId,
        messages: [{ type: "coupon", couponId: "COUPON_ghost" }],
      }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm run test:integration -- test/integration/coupon.test.ts`
Expected: "rejects unknown couponId" FAILS (currently accepted as any object, returning 200).

- [ ] **Step 3: Add coupon existence check in message.ts**

Edit `src/mock/message.ts`. Change the signature of `insertBotMessages` and add coupon validation. Replace the function body with:

```ts
async function insertBotMessages(
  channelDbId: number,
  toUserId: string,
  msgs: Array<Record<string, unknown>>
): Promise<{ inserted: Array<{ id: string }>; error: string | null }> {
  // Validate any coupon messages reference an existing coupon for this channel.
  for (const m of msgs) {
    if ((m as { type?: string }).type === "coupon") {
      const cid = (m as { couponId?: unknown }).couponId;
      if (typeof cid !== "string" || cid.length === 0) {
        return { inserted: [], error: "Invalid coupon message: couponId required" };
      }
      const [c] = await db
        .select({ id: coupons.id })
        .from(coupons)
        .where(
          and(
            eq(coupons.couponId, cid),
            eq(coupons.channelId, channelDbId)
          )
        )
        .limit(1);
      if (!c) {
        return { inserted: [], error: `Invalid coupon ID: ${cid}` };
      }
    }
  }

  const userRows = await db
    .select({ id: virtualUsers.id })
    .from(virtualUsers)
    .where(eq(virtualUsers.userId, toUserId))
    .limit(1);
  if (userRows.length === 0) {
    return { inserted: [], error: "Invalid user ID" };
  }
  const vuid = userRows[0].id;
  const inserted: Array<{ id: string }> = [];
  for (const m of msgs) {
    const mid = messageId();
    const type = String((m as { type?: string }).type ?? "text");
    const [row] = await db
      .insert(messages)
      .values({
        messageId: mid,
        channelId: channelDbId,
        virtualUserId: vuid,
        direction: "bot_to_user",
        type,
        payload: m,
      })
      .returning({ id: messages.id });
    bus.emitEvent({
      type: "message.inserted",
      channelId: channelDbId,
      virtualUserId: vuid,
      id: row.id,
    });
    inserted.push({ id: mid });
  }
  return { inserted, error: null };
}
```

Also add the new import at the top of the file:

```ts
import { messages, virtualUsers, channelFriends, coupons } from "../db/schema.js";
```

(Replace the existing `messages, virtualUsers, channelFriends` import to also include `coupons`.)

- [ ] **Step 4: Update callers to the new return shape**

Still in `src/mock/message.ts`, update every caller of `insertBotMessages` to destructure `{ inserted, error }` and respond with 400 on error.

In the **push** handler, replace:

```ts
  const inserted = await insertBotMessages(channelDbId, body.to, body.messages);
  if (inserted.length === 0) {
    return errors.badRequest(c, "Invalid user ID");
  }
  return c.json({ sentMessages: inserted });
```

with:

```ts
  const result = await insertBotMessages(channelDbId, body.to, body.messages);
  if (result.error) {
    return errors.badRequest(c, result.error);
  }
  return c.json({ sentMessages: result.inserted });
```

In the **multicast** handler, replace:

```ts
  for (const uid of body.to) {
    await insertBotMessages(channelDbId, uid, body.messages);
  }
  return c.json({});
```

with:

```ts
  for (const uid of body.to) {
    const result = await insertBotMessages(channelDbId, uid, body.messages);
    if (result.error && result.error.startsWith("Invalid coupon")) {
      return errors.badRequest(c, result.error);
    }
  }
  return c.json({});
```

(We only short-circuit multicast on coupon errors, not unknown-user errors — multicast tolerates some unknown recipients in LINE's real semantics.)

In the **broadcast** handler, replace:

```ts
  for (const f of friends) {
    await insertBotMessages(channelDbId, f.userId, body.messages);
  }
  return c.json({});
```

with:

```ts
  for (const f of friends) {
    const result = await insertBotMessages(channelDbId, f.userId, body.messages);
    if (result.error && result.error.startsWith("Invalid coupon")) {
      return errors.badRequest(c, result.error);
    }
  }
  return c.json({});
```

- [ ] **Step 5: Run all tests**

Run: `npm run test:integration`
Expected: all existing tests (push/reply/multicast/broadcast) PASS unchanged, plus the new coupon message tests PASS.

If the pre-existing `test/integration/push.test.ts` "rejects unknown user" test fails due to the return-shape change, re-read the push handler and confirm the 400 path is still taken.

- [ ] **Step 6: Commit**

```bash
git add src/mock/message.ts test/integration/coupon.test.ts
git commit -m "feat(line-api-mock): validate couponId existence in coupon messages"
```

---

## Task 7: Admin UI — Coupons page

**Files:**
- Create: `src/admin/pages/Coupons.tsx`
- Modify: `src/admin/routes.tsx`
- Modify: `src/admin/pages/Layout.tsx`

- [ ] **Step 1: Create the page component**

Create `src/admin/pages/Coupons.tsx`:

```tsx
import type { FC } from "hono/jsx";
import { Layout } from "./Layout.js";

export interface CouponRow {
  couponId: string;
  channelName: string;
  title: string;
  status: string;
  startTimestamp: number;
  endTimestamp: number;
  rewardSummary: string;
}

export interface ChannelOption {
  id: number;
  name: string;
}

export const Coupons: FC<{
  rows: CouponRow[];
  channels: ChannelOption[];
}> = ({ rows, channels }) => (
  <Layout title="Coupons">
    <h2 class="text-2xl font-semibold mb-4">Coupons</h2>

    <details class="bg-white rounded shadow p-4 mb-6">
      <summary class="cursor-pointer font-semibold">
        + New coupon (via admin shortcut)
      </summary>
      <form
        hx-post="/admin/coupons"
        hx-target="body"
        hx-swap="outerHTML"
        class="mt-3 grid grid-cols-2 gap-3"
      >
        <label class="flex flex-col text-sm">
          Channel
          <select name="channelId" class="border p-2 rounded" required>
            {channels.map((c) => (
              <option value={String(c.id)}>{c.name}</option>
            ))}
          </select>
        </label>
        <label class="flex flex-col text-sm">
          Title
          <input
            name="title"
            maxLength={60}
            required
            class="border p-2 rounded"
          />
        </label>
        <label class="flex flex-col text-sm col-span-2">
          Description
          <textarea name="description" maxLength={1000} class="border p-2 rounded" />
        </label>
        <label class="flex flex-col text-sm">
          Image URL
          <input name="imageUrl" type="url" class="border p-2 rounded" />
        </label>
        <label class="flex flex-col text-sm">
          Timezone
          <select name="timezone" class="border p-2 rounded" required>
            <option value="ASIA_TOKYO" selected>
              ASIA_TOKYO
            </option>
            <option value="ASIA_BANGKOK">ASIA_BANGKOK</option>
            <option value="ASIA_TAIPEI">ASIA_TAIPEI</option>
          </select>
        </label>
        <label class="flex flex-col text-sm">
          Start (ISO datetime)
          <input
            name="startTimestampIso"
            type="datetime-local"
            required
            class="border p-2 rounded"
          />
        </label>
        <label class="flex flex-col text-sm">
          End (ISO datetime)
          <input
            name="endTimestampIso"
            type="datetime-local"
            required
            class="border p-2 rounded"
          />
        </label>
        <label class="flex flex-col text-sm">
          Reward type
          <select name="rewardType" class="border p-2 rounded" required>
            <option value="discount" selected>
              discount
            </option>
            <option value="cashBack">cashBack</option>
            <option value="free">free</option>
            <option value="gift">gift</option>
            <option value="others">others</option>
          </select>
        </label>
        <label class="flex flex-col text-sm">
          Discount / cashback percent (1-99)
          <input
            name="percentage"
            type="number"
            min="1"
            max="99"
            value="10"
            class="border p-2 rounded"
          />
        </label>
        <button class="col-span-2 bg-green-600 text-white px-3 py-2 rounded">
          Create
        </button>
      </form>
    </details>

    <div class="bg-white rounded shadow overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-100">
          <tr>
            <th class="text-left p-2">Channel</th>
            <th class="text-left p-2">Title</th>
            <th class="text-left p-2">Reward</th>
            <th class="text-left p-2">Status</th>
            <th class="text-left p-2">Period</th>
            <th class="text-left p-2">couponId</th>
            <th class="text-left p-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr class="border-t">
              <td class="p-2">{r.channelName}</td>
              <td class="p-2">{r.title}</td>
              <td class="p-2">{r.rewardSummary}</td>
              <td class="p-2">
                <span
                  class={
                    r.status === "CLOSED"
                      ? "text-slate-500"
                      : "text-green-700 font-semibold"
                  }
                >
                  {r.status}
                </span>
              </td>
              <td class="p-2 text-xs font-mono">
                {new Date(r.startTimestamp * 1000).toISOString().slice(0, 16)}
                {" → "}
                {new Date(r.endTimestamp * 1000).toISOString().slice(0, 16)}
              </td>
              <td class="p-2 text-xs font-mono break-all">{r.couponId}</td>
              <td class="p-2">
                {r.status !== "CLOSED" && (
                  <form
                    hx-post={`/admin/coupons/${r.couponId}/close`}
                    hx-target="body"
                    hx-swap="outerHTML"
                    hx-confirm="Close this coupon?"
                  >
                    <button class="text-red-600 text-xs hover:underline">
                      Close
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Layout>
);
```

- [ ] **Step 2: Wire up admin routes**

Edit `src/admin/routes.tsx`. Add imports at the top (append to existing import block):

```ts
import { coupons } from "../db/schema.js";
import { Coupons } from "./pages/Coupons.js";
import { couponId as makeCouponId } from "../lib/id.js";
```

Then append these handlers at the bottom of the file (after the `/admin/api-log` handler):

```ts
adminRouter.get("/admin/coupons", async (c) => {
  const rows = await db
    .select({
      couponId: coupons.couponId,
      payload: coupons.payload,
      status: coupons.status,
      channelName: channels.name,
    })
    .from(coupons)
    .innerJoin(channels, eq(coupons.channelId, channels.id))
    .orderBy(desc(coupons.createdAt));

  const channelOpts = await db
    .select({ id: channels.id, name: channels.name })
    .from(channels);

  const viewRows = rows.map((r) => {
    const p = r.payload as any;
    const reward = p.reward ?? {};
    let summary = reward.type ?? "?";
    if (reward.type === "discount" || reward.type === "cashBack") {
      const pi = reward.priceInfo ?? {};
      if (pi.type === "percentage") summary = `${reward.type} ${pi.percentage}%`;
      else if (pi.type === "fixed") summary = `${reward.type} ¥${pi.fixedAmount}`;
    }
    return {
      couponId: r.couponId,
      channelName: r.channelName,
      title: p.title ?? "",
      status: r.status,
      startTimestamp: p.startTimestamp ?? 0,
      endTimestamp: p.endTimestamp ?? 0,
      rewardSummary: summary,
    };
  });

  return c.html(<Coupons rows={viewRows} channels={channelOpts} />);
});

adminRouter.post("/admin/coupons", async (c) => {
  const form = await c.req.parseBody();
  const channelId = Number(form.channelId);
  const title = String(form.title ?? "").trim();
  const description = String(form.description ?? "").trim() || undefined;
  const imageUrl = String(form.imageUrl ?? "").trim() || undefined;
  const timezone = String(form.timezone ?? "ASIA_TOKYO");
  const rewardType = String(form.rewardType ?? "discount");
  const percentage = Number(form.percentage ?? 10);
  const startIso = String(form.startTimestampIso ?? "");
  const endIso = String(form.endTimestampIso ?? "");

  if (!title || !startIso || !endIso) {
    return c.redirect("/admin/coupons");
  }
  const startTimestamp = Math.floor(new Date(startIso).getTime() / 1000);
  const endTimestamp = Math.floor(new Date(endIso).getTime() / 1000);
  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) {
    return c.redirect("/admin/coupons");
  }

  let reward: Record<string, unknown>;
  if (rewardType === "discount" || rewardType === "cashBack") {
    reward = {
      type: rewardType,
      priceInfo: { type: "percentage", percentage },
    };
  } else {
    reward = { type: rewardType };
  }

  const newId = makeCouponId();
  const detail: Record<string, unknown> = {
    couponId: newId,
    title,
    description,
    imageUrl,
    startTimestamp,
    endTimestamp,
    maxUseCountPerTicket: 1,
    timezone,
    visibility: "UNLISTED",
    acquisitionCondition: { type: "normal" },
    reward,
    status: "RUNNING",
    createdTimestamp: Math.floor(Date.now() / 1000),
  };
  await db.insert(coupons).values({
    couponId: newId,
    channelId,
    payload: detail,
    status: "RUNNING",
  });
  return c.redirect("/admin/coupons");
});

adminRouter.post("/admin/coupons/:couponId/close", async (c) => {
  const couponIdParam = c.req.param("couponId");
  const [row] = await db
    .select()
    .from(coupons)
    .where(eq(coupons.couponId, couponIdParam))
    .limit(1);
  if (row && row.status !== "CLOSED") {
    await db
      .update(coupons)
      .set({
        status: "CLOSED",
        payload: { ...(row.payload as object), status: "CLOSED" },
      })
      .where(eq(coupons.id, row.id));
  }
  return c.redirect("/admin/coupons");
});
```

- [ ] **Step 3: Add navigation link**

Edit `src/admin/pages/Layout.tsx`. In the `<nav>` block, add the Coupons link between Users and Webhooks:

```tsx
<a class="hover:underline" href="/admin/coupons">Coupons</a>
```

Final `<nav>` should read:
```tsx
<nav class="flex gap-4 text-sm">
  <a class="hover:underline" href="/admin">Dashboard</a>
  <a class="hover:underline" href="/admin/channels">Channels</a>
  <a class="hover:underline" href="/admin/users">Users</a>
  <a class="hover:underline" href="/admin/coupons">Coupons</a>
  <a class="hover:underline" href="/admin/webhook-log">Webhooks</a>
  <a class="hover:underline" href="/admin/api-log">API Log</a>
  <a class="hover:underline" href="/docs" target="_blank">Swagger</a>
</nav>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exits 0 with no errors.

- [ ] **Step 5: Manual smoke test**

Run: `docker compose up --build` in the project root.
Then open `http://localhost:3000/admin/coupons` and confirm:
- Page loads with empty table initially.
- Expanding "+ New coupon" shows the form.
- Submitting a coupon with title, dates (future), and channel returns to the same page with the coupon listed.
- "Close" button on a RUNNING coupon changes its status to CLOSED.

If `docker compose` is not available, run `npm run dev` and connect to an already-running Postgres (update `DATABASE_URL` env var).

- [ ] **Step 6: Commit**

```bash
git add src/admin/pages/Coupons.tsx src/admin/routes.tsx src/admin/pages/Layout.tsx
git commit -m "feat(line-api-mock): add Coupons admin UI page"
```

---

## Task 8: Render coupon messages as cards in Conversation view

**Files:**
- Modify: `src/admin/pages/Conversation.tsx`

- [ ] **Step 1: Add coupon card rendering**

Edit `src/admin/pages/Conversation.tsx`. Replace the current message-body `<div>` (the one containing `{JSON.stringify(m.payload)}`) so that `type:"coupon"` payloads render a card, while other types keep the existing JSON dump.

Find this block:

```tsx
<div class="font-mono text-xs whitespace-pre-wrap">
  {JSON.stringify(m.payload)}
</div>
```

Replace with:

```tsx
{m.type === "coupon" ? (
  <div class="text-xs">
    <div class="text-slate-600">🎟 Coupon</div>
    <div class="font-mono break-all">
      {(m.payload as any)?.couponId ?? "(no couponId)"}
    </div>
  </div>
) : (
  <div class="font-mono text-xs whitespace-pre-wrap">
    {JSON.stringify(m.payload)}
  </div>
)}
```

This is intentionally minimal — we only have the `couponId` at message-render time (not the full coupon detail). To show title/reward, the admin can follow the link to `/admin/coupons`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/admin/pages/Conversation.tsx
git commit -m "feat(line-api-mock): render coupon messages as cards in conversation"
```

---

## Task 9: SDK compatibility test

**Files:**
- Create: `test/sdk-compat/coupon.test.ts`

@line/bot-sdk v9.5.0 does not have a first-class `createCoupon` method, so this test verifies (a) the SDK can push a `{type:"coupon"}` message to our mock and (b) the mock still rejects unknown coupon IDs even when called via the SDK's HTTP layer.

- [ ] **Step 1: Create the test**

Create `test/sdk-compat/coupon.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { serve, type ServerType } from "@hono/node-server";
import { messagingApi } from "@line/bot-sdk";
import { startDb } from "../helpers/testcontainer.js";

let container: StartedPostgreSqlContainer;
let server: ServerType;
let port: number;
let token: string;
let botUserId: string;
let realCouponId: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { oauthRouter } = await import("../../src/mock/oauth.js");
  const { messageRouter } = await import("../../src/mock/message.js");
  const { couponRouter } = await import("../../src/mock/coupon.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens, virtualUsers, channelFriends } =
    await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9200000001",
      channelSecret: randomHex(16),
      name: "Coupon SDK Test",
    })
    .returning();
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });
  botUserId = "U" + randomHex(16);
  const [u] = await db
    .insert(virtualUsers)
    .values({ userId: botUserId, displayName: "SDK Coupon Tester" })
    .returning();
  await db
    .insert(channelFriends)
    .values({ channelId: ch.id, userId: u.id });

  const app = new Hono();
  app.route("/", oauthRouter);
  app.route("/", couponRouter);
  app.route("/", messageRouter);

  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      port = info.port;
      resolve();
    });
  });

  // Create a coupon over raw HTTP (SDK lacks createCoupon in v9).
  const createRes = await fetch(`http://127.0.0.1:${port}/v2/bot/coupon`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: "SDK coupon",
      startTimestamp: Math.floor(Date.now() / 1000),
      endTimestamp: Math.floor(Date.now() / 1000) + 86400,
      maxUseCountPerTicket: 1,
      timezone: "ASIA_TOKYO",
      visibility: "UNLISTED",
      acquisitionCondition: { type: "normal" },
      reward: {
        type: "discount",
        priceInfo: { type: "percentage", percentage: 15 },
      },
    }),
  });
  expect(createRes.status).toBe(200);
  realCouponId = (await createRes.json()).couponId;
}, 90_000);

afterAll(async () => {
  server?.close();
  await container.stop();
});

function sdkClient() {
  return new messagingApi.MessagingApiClient({
    channelAccessToken: token,
    baseURL: `http://127.0.0.1:${port}`,
  });
}

describe("@line/bot-sdk push coupon message against mock", () => {
  it("pushes a valid coupon message", async () => {
    const client = sdkClient();
    // SDK's typed Message union may not yet include "coupon"; cast to any.
    const res = await client.pushMessage({
      to: botUserId,
      messages: [{ type: "coupon", couponId: realCouponId } as any],
    });
    expect(res.sentMessages!.length).toBe(1);
  });

  it("fails when couponId is unknown", async () => {
    const client = sdkClient();
    await expect(
      client.pushMessage({
        to: botUserId,
        messages: [{ type: "coupon", couponId: "COUPON_nope" } as any],
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:sdk -- test/sdk-compat/coupon.test.ts`
Expected: both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add test/sdk-compat/coupon.test.ts
git commit -m "test(line-api-mock): SDK compat for coupon message push"
```

---

## Task 10: Update README

**Files:**
- Modify: `README.md` (the `line-api-mock/README.md`, not the repo root)

- [ ] **Step 1: Update the "実装済み" / "未実装" section**

Edit `README.md`. Find the "対応エンドポイント" section (around line 96). Update it so the "実装済み" list includes a new bullet for coupons. The section should read:

```markdown
## 対応エンドポイント

### 実装済み

- Channel Access Token (v2 / v3)
- Push / Reply / Multicast / Broadcast / Narrowcast
- Message quota / consumption
- Profile
- Webhook endpoint 設定 / テスト送信
- メッセージコンテンツ取得
- Coupon (作成 / 一覧 / 詳細 / close、`type:"coupon"` メッセージ)

### 未実装 (呼ぶと 501 を返す)

- Rich menu / LIFF / Insight / Audience / MLS / Shop / module-attach

Swagger UI には表示されますが、実装は v2 以降の予定です。
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(line-api-mock): mark coupon endpoints as implemented"
```

---

## Task 11: Final full test run

- [ ] **Step 1: Run the full unit + integration + sdk-compat suite**

Run from `line-api-mock/`:

```bash
npm run test:unit && npm run test:integration && npm run test:sdk
```

Expected: all three test groups PASS, no failures.

If anything fails, do not commit a fix on top. Go back to the task that introduced the regression, correct it there, and re-run.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Confirm git tree clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`.

---

## Self-Review Summary

**Spec coverage check:**
- [x] `coupons` table (spec §データモデル) → Task 1
- [x] POST `/v2/bot/coupon` (spec §API 엔드포인트) → Task 4
- [x] GET `/v2/bot/coupon/{couponId}` → Task 4
- [x] GET `/v2/bot/coupon` with status filter → Task 5
- [x] PUT `/v2/bot/coupon/{couponId}/close` → Task 5
- [x] `couponId` 생성 형식 (spec §couponId 생성) → Task 2
- [x] `type:"coupon"` message validation (spec §클러폰 메시지) → Task 6
- [x] `startTimestamp < endTimestamp` validation → Task 4 step 3
- [x] Double-close rejection → Task 5
- [x] Admin UI Coupons tab (spec §관리 UI) → Task 7
- [x] Coupon card rendering in Conversations → Task 8
- [x] Unit tests (coupon-schema) → Task 3
- [x] Integration tests (create→list→detail→close + message push) → Tasks 4/5/6
- [x] SDK compat tests → Task 9
- [x] README update → Task 10
- [x] Mount ordering respects `not-implemented.ts` (spec §未実装 루트) → Task 4 step 4

**Placeholder scan:** No TBD/TODO placeholders. Every step has concrete code or commands.

**Type consistency check:** `insertBotMessages` return type is changed in Task 6 and all three call sites (push/multicast/broadcast) are updated in that same task. `couponId()` helper name matches across Tasks 2, 4, and 7. `CouponRow` / `ChannelOption` interface names are consistent between Task 7's component definition and the consumer.

**Scope:** e2e Playwright test deliberately omitted (manual smoke test in Task 7 step 5 covers the UI path, and integration tests already cover API paths). If the subagent running this plan wants to add an e2e test, it should be a follow-up PR.
