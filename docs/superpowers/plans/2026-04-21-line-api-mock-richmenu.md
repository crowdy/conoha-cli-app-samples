# line-api-mock: Rich Menu (Core + Linking) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement LINE Messaging API's Rich Menu feature (Core CRUD + Image + User Linking + Admin UI) — 15 endpoints — in `line-api-mock`. Alias + Batch async are out of scope for this PR.

**Architecture:** 3 new Drizzle tables (`rich_menus`, `rich_menu_images`, `user_rich_menu_links`) plus one column on `channels`. Two new Hono routers (`rich-menu.ts` for CRUD+image, `rich-menu-link.ts` for linking) reuse the existing `bearerAuth` + ajv `validate` middleware. Admin UI follows the Coupons pattern (HTMX + Tailwind).

**Tech Stack:** TypeScript, Hono, Drizzle ORM + PostgreSQL 17, ajv, HTMX + Tailwind, vitest, testcontainers, @line/bot-sdk.

**All work from `line-api-mock/`.**

---

## File Structure

**New files:**
- `src/mock/rich-menu.ts` — 7 CRUD + image handlers
- `src/mock/rich-menu-link.ts` — 8 link/default/bulk handlers
- `src/admin/pages/RichMenus.tsx` — admin page component
- `test/unit/rich-menu-id.test.ts`
- `test/integration/rich-menu.test.ts`
- `test/sdk-compat/rich-menu.test.ts`
- `drizzle/0002_*.sql` (auto-generated)

**Modified files:**
- `src/db/schema.ts` — 3 tables + `defaultRichMenuId` column
- `src/lib/id.ts` — add `richMenuId()` generator
- `src/mock/not-implemented.ts` — remove `/v2/bot/richmenu*` lines
- `src/index.ts` — mount 2 new routers
- `src/admin/routes.tsx` — admin handlers
- `src/admin/pages/Layout.tsx` — nav link
- `line-api-mock/README.md` — implementation status

---

## Task 1: Schema + Migration

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0002_*.sql` (auto-generated)

- [ ] **Step 1: Add three tables + one column**

In `src/db/schema.ts`, append at the end of the file (after `coupons`):

```ts
export const richMenus = pgTable("rich_menus", {
  id: serial("id").primaryKey(),
  richMenuId: text("rich_menu_id").notNull().unique(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const richMenuImages = pgTable("rich_menu_images", {
  richMenuId: integer("rich_menu_id")
    .primaryKey()
    .references(() => richMenus.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
});

export const userRichMenuLinks = pgTable(
  "user_rich_menu_links",
  {
    channelId: integer("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => virtualUsers.id, { onDelete: "cascade" }),
    richMenuId: integer("rich_menu_id")
      .notNull()
      .references(() => richMenus.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.channelId, t.userId] }) })
);
```

Then modify the `channels` table definition to add a new column. Change the existing `channels` definition from:

```ts
export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull().unique(),
  channelSecret: text("channel_secret").notNull(),
  name: text("name").notNull(),
  webhookUrl: text("webhook_url"),
  webhookEnabled: boolean("webhook_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

to (adding `defaultRichMenuId`):

```ts
export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  channelId: text("channel_id").notNull().unique(),
  channelSecret: text("channel_secret").notNull(),
  name: text("name").notNull(),
  webhookUrl: text("webhook_url"),
  webhookEnabled: boolean("webhook_enabled").notNull().default(true),
  defaultRichMenuId: integer("default_rich_menu_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

(The FK on `defaultRichMenuId → rich_menus.id ON DELETE SET NULL` is applied via drizzle-kit generate. If drizzle-kit cannot generate the FK in this direction due to ordering, the generated SQL will be manually adjustable in Step 2.)

All required imports (`pgTable`, `serial`, `text`, `integer`, `boolean`, `jsonb`, `timestamp`, `primaryKey`, `bytea`) are already present in the file.

- [ ] **Step 2: Generate migration**

Run (from `line-api-mock/`):
```bash
npm run db:generate
```

Expected: `drizzle/0002_<adjective>_<noun>.sql` is created and `drizzle/meta/_journal.json` appended.

Verify the SQL file contains:
- `CREATE TABLE "rich_menus"` with `coupon_id` → actually `rich_menu_id` — double-check it's `rich_menu_id`
- `CREATE TABLE "rich_menu_images"` with `bytea` data column
- `CREATE TABLE "user_rich_menu_links"` with composite PK
- `ALTER TABLE "channels" ADD COLUMN "default_rich_menu_id"` (no FK constraint is OK — we'll add it in Step 3 if missing)

Run: `cat drizzle/0002_*.sql`

- [ ] **Step 3: Add FK on `channels.default_rich_menu_id` if missing**

If the generated SQL does NOT include a FK constraint linking `channels.default_rich_menu_id` to `rich_menus.id`, drizzle-kit may have omitted it due to circular dependency. This is acceptable — we don't strictly need DB-level FK here because the application manages the reference. Skip adding it manually to avoid migration ordering pain.

If drizzle DOES add the FK with `ON DELETE NO ACTION`, manually edit the generated SQL to change `NO ACTION` to `SET NULL` for this specific FK. Use:

```bash
# Inspect first:
grep -n "default_rich_menu_id" drizzle/0002_*.sql
```

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/0002_*.sql drizzle/meta/
git commit -m "feat(line-api-mock): add rich_menus, rich_menu_images, user_rich_menu_links schema"
```

---

## Task 2: `richMenuId()` generator

**Files:**
- Modify: `src/lib/id.ts`
- Create: `test/unit/rich-menu-id.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/rich-menu-id.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { richMenuId } from "../../src/lib/id.js";

describe("richMenuId()", () => {
  it("returns a string matching LINE format", () => {
    expect(richMenuId()).toMatch(/^richmenu-[0-9a-f]{32}$/);
  });

  it("is unique across many calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(richMenuId());
    expect(set.size).toBe(1000);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm run test:unit -- test/unit/rich-menu-id.test.ts`
Expected: FAIL with import error (`richMenuId` not exported).

- [ ] **Step 3: Implement**

Append to `src/lib/id.ts`:

```ts
export function richMenuId(): string {
  return "richmenu-" + randomBytes(16).toString("hex");
}
```

(`randomBytes` is already imported.)

- [ ] **Step 4: Run — expect pass**

Run: `npm run test:unit -- test/unit/rich-menu-id.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/id.ts test/unit/rich-menu-id.test.ts
git commit -m "feat(line-api-mock): add richMenuId() generator"
```

---

## Task 3: Core CRUD router (create, validate, get, list, delete)

**Files:**
- Create: `src/mock/rich-menu.ts`
- Create: `test/integration/rich-menu.test.ts`

This task creates the router and 5 endpoints. Image upload/download (Task 4) goes into the same file but in a separate commit.

- [ ] **Step 1: Write the failing integration test**

Create `test/integration/rich-menu.test.ts`:

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
  const { richMenuRouter } = await import("../../src/mock/rich-menu.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens } = await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9500000001",
      channelSecret: randomHex(16),
      name: "RichMenu Test",
    })
    .returning();
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  app = new Hono();
  app.route("/", richMenuRouter);
}, 60_000);

afterAll(async () => container.stop());

export function validRichMenuBody() {
  return {
    size: { width: 2500, height: 1686 },
    selected: false,
    name: "Test menu",
    chatBarText: "Menu",
    areas: [
      {
        bounds: { x: 0, y: 0, width: 1250, height: 1686 },
        action: { type: "postback", data: "a=1" },
      },
    ],
  };
}

describe("POST /v2/bot/richmenu", () => {
  it("creates a rich menu and returns richMenuId", async () => {
    const res = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validRichMenuBody()),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.richMenuId).toMatch(/^richmenu-[0-9a-f]{32}$/);
  });

  it("rejects missing chatBarText with 400", async () => {
    const body: any = validRichMenuBody();
    delete body.chatBarText;
    const res = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing bearer with 401", async () => {
    const res = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validRichMenuBody()),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /v2/bot/richmenu/validate", () => {
  it("returns 200 on valid body", async () => {
    const res = await app.request("/v2/bot/richmenu/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validRichMenuBody()),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("returns 400 on invalid body", async () => {
    const res = await app.request("/v2/bot/richmenu/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ size: { width: "nope" } }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v2/bot/richmenu/:richMenuId", () => {
  it("returns the created rich menu", async () => {
    const createRes = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validRichMenuBody()),
    });
    const { richMenuId } = await createRes.json();

    const res = await app.request(`/v2/bot/richmenu/${richMenuId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.richMenuId).toBe(richMenuId);
    expect(body.size.width).toBe(2500);
    expect(body.name).toBe("Test menu");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.request("/v2/bot/richmenu/richmenu-0000", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /v2/bot/richmenu/list", () => {
  it("returns all rich menus for the channel", async () => {
    const res = await app.request("/v2/bot/richmenu/list", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.richmenus)).toBe(true);
    expect(body.richmenus.length).toBeGreaterThanOrEqual(1);
    expect(body.richmenus[0].richMenuId).toMatch(/^richmenu-[0-9a-f]{32}$/);
  });
});

describe("DELETE /v2/bot/richmenu/:richMenuId", () => {
  it("deletes and returns 200, subsequent GET is 404", async () => {
    const create = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validRichMenuBody(), name: "to-delete" }),
    });
    const { richMenuId } = await create.json();

    const del = await app.request(`/v2/bot/richmenu/${richMenuId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(200);

    const get = await app.request(`/v2/bot/richmenu/${richMenuId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(get.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm run test:integration -- test/integration/rich-menu.test.ts`
Expected: FAIL (`richMenuRouter` not exported from `src/mock/rich-menu.js`).

- [ ] **Step 3: Create the router**

Create `src/mock/rich-menu.ts`:

```ts
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

richMenuRouter.post(
  "/v2/bot/richmenu",
  validate({
    requestSchema: "#/components/schemas/RichMenuRequest",
    responseSchema: "#/components/schemas/RichMenuIdResponse",
  }),
  async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
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
  (c) => c.body(null, 200)
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
```

- [ ] **Step 4: Run — expect pass**

Run: `npm run test:integration -- test/integration/rich-menu.test.ts`
Expected: all tests PASS (3+2+2+1+1 = 9 tests).

If response-schema drift warnings fire (e.g. for `GET /list` because the stored payload lacks required fields), inspect `specs/messaging-api.yml:3382` — `RichMenuListResponse` requires `richmenus: [RichMenuResponse]`, and `RichMenuResponse` requires all six fields. Make sure `validRichMenuBody()` in the test supplies all required fields (it does).

- [ ] **Step 5: Commit**

```bash
git add src/mock/rich-menu.ts test/integration/rich-menu.test.ts
git commit -m "feat(line-api-mock): implement rich menu core CRUD (create/validate/get/list/delete)"
```

---

## Task 4: Image upload + download

**Files:**
- Modify: `src/mock/rich-menu.ts`
- Modify: `test/integration/rich-menu.test.ts`

- [ ] **Step 1: Append image tests**

Append to `test/integration/rich-menu.test.ts`:

```ts
// Minimal valid PNG (1x1 transparent) for testing.
const PNG_1x1 = Buffer.from(
  "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415408996360000000000500010D0A2DB40000000049454E44AE426082",
  "hex"
);

describe("Rich menu image upload/download", () => {
  let id: string;
  beforeAll(async () => {
    const create = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validRichMenuBody(), name: "image-host" }),
    });
    const body = await create.json();
    id = body.richMenuId;
  });

  it("accepts PNG upload and serves it back with same bytes", async () => {
    const up = await app.request(`/v2/bot/richmenu/${id}/content`, {
      method: "POST",
      headers: {
        "content-type": "image/png",
        authorization: `Bearer ${token}`,
      },
      body: PNG_1x1,
    });
    expect(up.status).toBe(200);

    const down = await app.request(`/v2/bot/richmenu/${id}/content`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(down.status).toBe(200);
    expect(down.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await down.arrayBuffer());
    expect(bytes.equals(PNG_1x1)).toBe(true);
  });

  it("rejects non-image content-type with 400", async () => {
    const res = await app.request(`/v2/bot/richmenu/${id}/content`, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        authorization: `Bearer ${token}`,
      },
      body: Buffer.from("hello"),
    });
    expect(res.status).toBe(400);
  });

  it("rejects upload > 1 MB with 400", async () => {
    const big = Buffer.alloc(1_048_577, 0);
    const res = await app.request(`/v2/bot/richmenu/${id}/content`, {
      method: "POST",
      headers: {
        "content-type": "image/png",
        authorization: `Bearer ${token}`,
      },
      body: big,
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 downloading image of unknown rich menu", async () => {
    const res = await app.request(
      "/v2/bot/richmenu/richmenu-0000000000000000000000000000/content",
      { headers: { authorization: `Bearer ${token}` } }
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run — expect failure (404 on upload)**

Run: `npm run test:integration -- test/integration/rich-menu.test.ts`
Expected: image tests FAIL (routes not implemented yet).

- [ ] **Step 3: Add upload/download handlers**

Append to `src/mock/rich-menu.ts` before the existing `.delete(...)` handler. Also update the import line at the top to include `richMenuImages`:

Find:
```ts
import { richMenus } from "../db/schema.js";
```
Change to:
```ts
import { richMenus, richMenuImages } from "../db/schema.js";
```

Then append these handlers to `src/mock/rich-menu.ts` (after the existing handlers, before the file end):

```ts
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
```

- [ ] **Step 4: Run — expect pass**

Run: `npm run test:integration -- test/integration/rich-menu.test.ts`
Expected: all coupon tests pass (previous 9 + new 4 = 13).

- [ ] **Step 5: Commit**

```bash
git add src/mock/rich-menu.ts test/integration/rich-menu.test.ts
git commit -m "feat(line-api-mock): implement rich menu image upload/download"
```

---

## Task 5: User linking (link/unlink/get) + Default (set/get/unset)

**Files:**
- Create: `src/mock/rich-menu-link.ts`
- Modify: `test/integration/rich-menu.test.ts`

- [ ] **Step 1: Append tests**

Append to `test/integration/rich-menu.test.ts`:

```ts
describe("User linking", () => {
  let botUserId: string;
  let linkedMenuId: string;

  beforeAll(async () => {
    const { db } = await import("../../src/db/client.js");
    const { channels, virtualUsers, channelFriends } = await import(
      "../../src/db/schema.js"
    );
    const { randomHex } = await import("../../src/lib/id.js");
    const { eq: eqFn } = await import("drizzle-orm");

    const [ch] = await db
      .select()
      .from(channels)
      .where(eqFn(channels.channelId, "9500000001"))
      .limit(1);

    botUserId = "U" + randomHex(16);
    const [u] = await db
      .insert(virtualUsers)
      .values({ userId: botUserId, displayName: "Link target" })
      .returning();
    await db
      .insert(channelFriends)
      .values({ channelId: ch.id, userId: u.id });

    // Create + upload image so link is allowed.
    const { richMenuLinkRouter } = await import(
      "../../src/mock/rich-menu-link.js"
    );
    app.route("/", richMenuLinkRouter);

    const create = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validRichMenuBody(), name: "linker" }),
    });
    linkedMenuId = (await create.json()).richMenuId;
    await app.request(`/v2/bot/richmenu/${linkedMenuId}/content`, {
      method: "POST",
      headers: {
        "content-type": "image/png",
        authorization: `Bearer ${token}`,
      },
      body: PNG_1x1,
    });
  });

  it("links a rich menu to a user and reads it back", async () => {
    const link = await app.request(
      `/v2/bot/user/${botUserId}/richmenu/${linkedMenuId}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }
    );
    expect(link.status).toBe(200);

    const get = await app.request(`/v2/bot/user/${botUserId}/richmenu`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(get.status).toBe(200);
    const body = await get.json();
    expect(body.richMenuId).toBe(linkedMenuId);
  });

  it("unlinks and subsequent GET is 404", async () => {
    const del = await app.request(`/v2/bot/user/${botUserId}/richmenu`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(200);

    const get = await app.request(`/v2/bot/user/${botUserId}/richmenu`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(get.status).toBe(404);
  });

  it("rejects linking a menu without an image with 400", async () => {
    const create = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validRichMenuBody(), name: "no-image" }),
    });
    const { richMenuId: noImgId } = await create.json();

    const res = await app.request(
      `/v2/bot/user/${botUserId}/richmenu/${noImgId}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }
    );
    expect(res.status).toBe(400);
  });
});

describe("Default rich menu", () => {
  let defaultMenuId: string;

  beforeAll(async () => {
    const create = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validRichMenuBody(), name: "default-menu" }),
    });
    defaultMenuId = (await create.json()).richMenuId;
    await app.request(`/v2/bot/richmenu/${defaultMenuId}/content`, {
      method: "POST",
      headers: {
        "content-type": "image/png",
        authorization: `Bearer ${token}`,
      },
      body: PNG_1x1,
    });
  });

  it("sets, reads, and unsets default", async () => {
    const set = await app.request(`/v2/bot/user/all/richmenu/${defaultMenuId}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(set.status).toBe(200);

    const get = await app.request("/v2/bot/user/all/richmenu", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(get.status).toBe(200);
    expect((await get.json()).richMenuId).toBe(defaultMenuId);

    const unset = await app.request("/v2/bot/user/all/richmenu", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(unset.status).toBe(200);

    const get2 = await app.request("/v2/bot/user/all/richmenu", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(get2.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `npm run test:integration -- test/integration/rich-menu.test.ts`
Expected: FAIL (`richMenuLinkRouter` not exported).

- [ ] **Step 3: Create the linking router**

Create `src/mock/rich-menu-link.ts`:

```ts
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  channels,
  richMenus,
  richMenuImages,
  userRichMenuLinks,
  virtualUsers,
} from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { errors } from "../lib/errors.js";

export const richMenuLinkRouter = new Hono<{ Variables: AuthVars }>();

richMenuLinkRouter.use("/v2/bot/user/*", requestLog);
richMenuLinkRouter.use("/v2/bot/user/*", bearerAuth);

async function findRichMenuWithImage(
  channelDbId: number,
  richMenuIdStr: string
): Promise<{ internalId: number } | { error: "notfound" | "no_image" }> {
  const [row] = await db
    .select({
      internalId: richMenus.id,
      hasImage: richMenuImages.richMenuId,
    })
    .from(richMenus)
    .leftJoin(richMenuImages, eq(richMenus.id, richMenuImages.richMenuId))
    .where(
      and(
        eq(richMenus.richMenuId, richMenuIdStr),
        eq(richMenus.channelId, channelDbId)
      )
    )
    .limit(1);
  if (!row) return { error: "notfound" };
  if (row.hasImage === null) return { error: "no_image" };
  return { internalId: row.internalId };
}

async function findVirtualUser(
  channelDbId: number,
  userIdStr: string
): Promise<{ id: number } | null> {
  const [u] = await db
    .select({ id: virtualUsers.id })
    .from(virtualUsers)
    .where(eq(virtualUsers.userId, userIdStr))
    .limit(1);
  if (!u) return null;
  // We do not require channelFriend membership for linking (LINE's real API
  // links a rich menu to any userId known to the bot). The channelDbId is
  // enforced on the link row's channelId column below.
  void channelDbId;
  return { id: u.id };
}

// === Per-user: link / get / unlink ===

richMenuLinkRouter.post(
  "/v2/bot/user/:userId/richmenu/:richMenuId",
  async (c) => {
    const userIdStr = c.req.param("userId");
    const richMenuIdStr = c.req.param("richMenuId");
    const channelDbId = c.get("channelDbId");

    const rm = await findRichMenuWithImage(channelDbId, richMenuIdStr);
    if ("error" in rm) {
      if (rm.error === "notfound") return errors.notFound(c);
      return errors.badRequest(c, "Rich menu has no uploaded image");
    }

    const u = await findVirtualUser(channelDbId, userIdStr);
    if (!u) return errors.notFound(c);

    // UPSERT: delete any prior link for (channel,user), then insert.
    await db
      .delete(userRichMenuLinks)
      .where(
        and(
          eq(userRichMenuLinks.channelId, channelDbId),
          eq(userRichMenuLinks.userId, u.id)
        )
      );
    await db.insert(userRichMenuLinks).values({
      channelId: channelDbId,
      userId: u.id,
      richMenuId: rm.internalId,
    });
    return c.json({});
  }
);

richMenuLinkRouter.get("/v2/bot/user/:userId/richmenu", async (c) => {
  const userIdStr = c.req.param("userId");
  const channelDbId = c.get("channelDbId");
  const rows = await db
    .select({ richMenuIdStr: richMenus.richMenuId })
    .from(userRichMenuLinks)
    .innerJoin(virtualUsers, eq(userRichMenuLinks.userId, virtualUsers.id))
    .innerJoin(richMenus, eq(userRichMenuLinks.richMenuId, richMenus.id))
    .where(
      and(
        eq(userRichMenuLinks.channelId, channelDbId),
        eq(virtualUsers.userId, userIdStr)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return errors.notFound(c);
  return c.json({ richMenuId: row.richMenuIdStr });
});

richMenuLinkRouter.delete("/v2/bot/user/:userId/richmenu", async (c) => {
  const userIdStr = c.req.param("userId");
  const channelDbId = c.get("channelDbId");
  const u = await findVirtualUser(channelDbId, userIdStr);
  if (!u) return errors.notFound(c);
  await db
    .delete(userRichMenuLinks)
    .where(
      and(
        eq(userRichMenuLinks.channelId, channelDbId),
        eq(userRichMenuLinks.userId, u.id)
      )
    );
  return c.json({});
});

// === Default: set / get / unset ===

richMenuLinkRouter.post(
  "/v2/bot/user/all/richmenu/:richMenuId",
  async (c) => {
    const richMenuIdStr = c.req.param("richMenuId");
    const channelDbId = c.get("channelDbId");
    const rm = await findRichMenuWithImage(channelDbId, richMenuIdStr);
    if ("error" in rm) {
      if (rm.error === "notfound") return errors.notFound(c);
      return errors.badRequest(c, "Rich menu has no uploaded image");
    }
    await db
      .update(channels)
      .set({ defaultRichMenuId: rm.internalId })
      .where(eq(channels.id, channelDbId));
    return c.json({});
  }
);

richMenuLinkRouter.get("/v2/bot/user/all/richmenu", async (c) => {
  const channelDbId = c.get("channelDbId");
  const [row] = await db
    .select({
      defaultId: channels.defaultRichMenuId,
    })
    .from(channels)
    .where(eq(channels.id, channelDbId))
    .limit(1);
  if (!row || row.defaultId === null) return errors.notFound(c);
  const [rm] = await db
    .select({ richMenuIdStr: richMenus.richMenuId })
    .from(richMenus)
    .where(eq(richMenus.id, row.defaultId))
    .limit(1);
  if (!rm) return errors.notFound(c);
  return c.json({ richMenuId: rm.richMenuIdStr });
});

richMenuLinkRouter.delete("/v2/bot/user/all/richmenu", async (c) => {
  const channelDbId = c.get("channelDbId");
  await db
    .update(channels)
    .set({ defaultRichMenuId: null })
    .where(eq(channels.id, channelDbId));
  return c.json({});
});
```

- [ ] **Step 4: Run — expect pass**

Run: `npm run test:integration -- test/integration/rich-menu.test.ts`
Expected: all tests pass (previous 13 + new 4 = 17).

- [ ] **Step 5: Commit**

```bash
git add src/mock/rich-menu-link.ts test/integration/rich-menu.test.ts
git commit -m "feat(line-api-mock): implement rich menu user linking + default"
```

---

## Task 6: Bulk link/unlink

**Files:**
- Modify: `src/mock/rich-menu-link.ts`
- Modify: `test/integration/rich-menu.test.ts`

- [ ] **Step 1: Append tests**

Append to `test/integration/rich-menu.test.ts`:

```ts
describe("Bulk link/unlink", () => {
  let bulkMenuId: string;
  let uids: string[];

  beforeAll(async () => {
    const { richMenuLinkRouter } = await import(
      "../../src/mock/rich-menu-link.js"
    );
    // Already mounted in earlier describe's beforeAll; mounting again is idempotent for our tests.
    void richMenuLinkRouter;

    const { db } = await import("../../src/db/client.js");
    const { channels, virtualUsers, channelFriends } = await import(
      "../../src/db/schema.js"
    );
    const { randomHex } = await import("../../src/lib/id.js");
    const { eq: eqFn } = await import("drizzle-orm");

    const [ch] = await db
      .select()
      .from(channels)
      .where(eqFn(channels.channelId, "9500000001"))
      .limit(1);

    uids = [];
    for (let i = 0; i < 3; i++) {
      const uid = "U" + randomHex(16);
      uids.push(uid);
      const [u] = await db
        .insert(virtualUsers)
        .values({ userId: uid, displayName: `Bulk ${i}` })
        .returning();
      await db
        .insert(channelFriends)
        .values({ channelId: ch.id, userId: u.id });
    }

    const create = await app.request("/v2/bot/richmenu", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...validRichMenuBody(), name: "bulk" }),
    });
    bulkMenuId = (await create.json()).richMenuId;
    await app.request(`/v2/bot/richmenu/${bulkMenuId}/content`, {
      method: "POST",
      headers: {
        "content-type": "image/png",
        authorization: `Bearer ${token}`,
      },
      body: PNG_1x1,
    });
  });

  it("bulk link returns 202 and each user ends up linked", async () => {
    const res = await app.request("/v2/bot/richmenu/bulk/link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ richMenuId: bulkMenuId, userIds: uids }),
    });
    expect(res.status).toBe(202);

    for (const uid of uids) {
      const g = await app.request(`/v2/bot/user/${uid}/richmenu`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(g.status).toBe(200);
      expect((await g.json()).richMenuId).toBe(bulkMenuId);
    }
  });

  it("bulk unlink returns 202 and clears links", async () => {
    const res = await app.request("/v2/bot/richmenu/bulk/unlink", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userIds: uids }),
    });
    expect(res.status).toBe(202);

    for (const uid of uids) {
      const g = await app.request(`/v2/bot/user/${uid}/richmenu`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(g.status).toBe(404);
    }
  });

  it("bulk link silently skips unknown userIds", async () => {
    const res = await app.request("/v2/bot/richmenu/bulk/link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        richMenuId: bulkMenuId,
        userIds: [uids[0], "Uffffffffffffffffffffffffffffffff"],
      }),
    });
    expect(res.status).toBe(202);

    const g = await app.request(`/v2/bot/user/${uids[0]}/richmenu`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(g.status).toBe(200);
  });

  it("bulk link rejects > 500 userIds with 400", async () => {
    const many = Array.from({ length: 501 }, (_, i) => "U" + String(i).padStart(32, "0"));
    const res = await app.request("/v2/bot/richmenu/bulk/link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ richMenuId: bulkMenuId, userIds: many }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run — expect failure (404 on bulk endpoints)**

Run: `npm run test:integration -- test/integration/rich-menu.test.ts`
Expected: bulk tests FAIL.

- [ ] **Step 3: Add bulk handlers**

Append to `src/mock/rich-menu-link.ts` (at the end of the file):

```ts
richMenuLinkRouter.use("/v2/bot/richmenu/bulk/*", requestLog);
richMenuLinkRouter.use("/v2/bot/richmenu/bulk/*", bearerAuth);

richMenuLinkRouter.post("/v2/bot/richmenu/bulk/link", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { richMenuId?: string; userIds?: string[] }
    | null;
  if (!body || typeof body.richMenuId !== "string" || !Array.isArray(body.userIds)) {
    return errors.badRequest(c, "richMenuId and userIds are required");
  }
  if (body.userIds.length < 1 || body.userIds.length > 500) {
    return errors.badRequest(c, "userIds length must be 1..500");
  }
  const channelDbId = c.get("channelDbId");
  const rm = await findRichMenuWithImage(channelDbId, body.richMenuId);
  if ("error" in rm) {
    if (rm.error === "notfound") return errors.badRequest(c, "Unknown rich menu");
    return errors.badRequest(c, "Rich menu has no uploaded image");
  }

  for (const uid of body.userIds) {
    const u = await findVirtualUser(channelDbId, uid);
    if (!u) continue;
    await db
      .delete(userRichMenuLinks)
      .where(
        and(
          eq(userRichMenuLinks.channelId, channelDbId),
          eq(userRichMenuLinks.userId, u.id)
        )
      );
    await db.insert(userRichMenuLinks).values({
      channelId: channelDbId,
      userId: u.id,
      richMenuId: rm.internalId,
    });
  }
  return c.body(null, 202);
});

richMenuLinkRouter.post("/v2/bot/richmenu/bulk/unlink", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { userIds?: string[] }
    | null;
  if (!body || !Array.isArray(body.userIds)) {
    return errors.badRequest(c, "userIds is required");
  }
  if (body.userIds.length < 1 || body.userIds.length > 500) {
    return errors.badRequest(c, "userIds length must be 1..500");
  }
  const channelDbId = c.get("channelDbId");
  for (const uid of body.userIds) {
    const u = await findVirtualUser(channelDbId, uid);
    if (!u) continue;
    await db
      .delete(userRichMenuLinks)
      .where(
        and(
          eq(userRichMenuLinks.channelId, channelDbId),
          eq(userRichMenuLinks.userId, u.id)
        )
      );
  }
  return c.body(null, 202);
});
```

- [ ] **Step 4: Run — expect pass**

Run: `npm run test:integration -- test/integration/rich-menu.test.ts`
Expected: all tests pass (previous 17 + new 4 = 21).

- [ ] **Step 5: Commit**

```bash
git add src/mock/rich-menu-link.ts test/integration/rich-menu.test.ts
git commit -m "feat(line-api-mock): implement rich menu bulk link/unlink"
```

---

## Task 7: Mount routers + remove from not-implemented

**Files:**
- Modify: `src/mock/not-implemented.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Remove richmenu lines from not-implemented.ts**

Edit `src/mock/not-implemented.ts`. Find:

```ts
notImplementedRouter.all("/v2/bot/richmenu/*", (c) => errors.notImplemented(c));
notImplementedRouter.all("/v2/bot/richmenu", (c) => errors.notImplemented(c));
```

Delete both lines. The `/v2/bot/user/*` catch-all stays — our rich-menu-link router will be mounted first so it takes priority.

Final file should read:

```ts
import { Hono } from "hono";
import { errors } from "../lib/errors.js";

export const notImplementedRouter = new Hono();

notImplementedRouter.all("/v2/bot/audienceGroup/*", (c) =>
  errors.notImplemented(c)
);
notImplementedRouter.all("/v2/bot/insight/*", (c) => errors.notImplemented(c));
notImplementedRouter.all("/v2/bot/user/*", (c) => errors.notImplemented(c));
notImplementedRouter.all("/v2/bot/group/*", (c) => errors.notImplemented(c));
notImplementedRouter.all("/v2/bot/room/*", (c) => errors.notImplemented(c));
```

- [ ] **Step 2: Mount new routers in `src/index.ts`**

Edit `src/index.ts`. Add imports near the other mock imports:

```ts
import { richMenuRouter } from "./mock/rich-menu.js";
import { richMenuLinkRouter } from "./mock/rich-menu-link.js";
```

Add the two `app.route` mounts, placing them BEFORE `adminRouter` and `notImplementedRouter`. The full block should look like:

```ts
app.route("/", oauthRouter);
app.route("/", oauthV3Router);
app.route("/", messageRouter);
app.route("/", quotaRouter);
app.route("/", profileRouter);
app.route("/", webhookEndpointRouter);
app.route("/", contentRouter);
app.route("/", couponRouter);
app.route("/", validateRouter);
app.route("/", botInfoRouter);
app.route("/", richMenuRouter);
app.route("/", richMenuLinkRouter);
app.route("/", adminRouter);
app.route("/", notImplementedRouter);
```

- [ ] **Step 3: Typecheck + integration**

Run:
```bash
npm run typecheck
npm run test:integration
```

Expected: 0 errors from typecheck, all integration tests pass (previous + rich-menu tests).

- [ ] **Step 4: Commit**

```bash
git add src/mock/not-implemented.ts src/index.ts
git commit -m "feat(line-api-mock): mount rich menu routers, remove from not-implemented"
```

---

## Task 8: Admin UI — RichMenus page

**Files:**
- Create: `src/admin/pages/RichMenus.tsx`
- Modify: `src/admin/routes.tsx`
- Modify: `src/admin/pages/Layout.tsx`

- [ ] **Step 1: Create the page component**

Create `src/admin/pages/RichMenus.tsx`:

```tsx
import type { FC } from "hono/jsx";
import { Layout } from "./Layout.js";

export interface RichMenuRow {
  richMenuId: string;
  channelDbId: number;
  channelName: string;
  name: string;
  chatBarText: string;
  size: { width: number; height: number };
  areaCount: number;
  hasImage: boolean;
  linkedUsers: number;
  isDefault: boolean;
}

export interface ChannelOption {
  id: number;
  name: string;
}

export interface VirtualUserOption {
  dbId: number;
  userIdStr: string;
  displayName: string;
  channelDbId: number;
}

export const RichMenus: FC<{
  rows: RichMenuRow[];
  channels: ChannelOption[];
  users: VirtualUserOption[];
}> = ({ rows, channels, users }) => (
  <Layout title="Rich Menus">
    <h2 class="text-2xl font-semibold mb-4">Rich Menus</h2>

    <details class="bg-white rounded shadow p-4 mb-6">
      <summary class="cursor-pointer font-semibold">
        + New rich menu (paste JSON)
      </summary>
      <form
        hx-post="/admin/richmenus"
        hx-target="body"
        hx-swap="outerHTML"
        class="mt-3 flex flex-col gap-3"
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
          RichMenuRequest JSON
          <textarea
            name="json"
            required
            rows={10}
            class="border p-2 rounded font-mono text-xs"
            placeholder='{"size":{"width":2500,"height":1686},"selected":false,"name":"Menu","chatBarText":"Tap","areas":[{"bounds":{"x":0,"y":0,"width":2500,"height":1686},"action":{"type":"postback","data":"a=1"}}]}'
          />
        </label>
        <button class="bg-green-600 text-white px-3 py-2 rounded">Create</button>
      </form>
    </details>

    <div class="bg-white rounded shadow overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-100">
          <tr>
            <th class="text-left p-2">Image</th>
            <th class="text-left p-2">Channel</th>
            <th class="text-left p-2">Name</th>
            <th class="text-left p-2">Size</th>
            <th class="text-left p-2">Areas</th>
            <th class="text-left p-2">Linked</th>
            <th class="text-left p-2">Default</th>
            <th class="text-left p-2">ID</th>
            <th class="text-left p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const channelUsers = users.filter(
              (u) => u.channelDbId === r.channelDbId
            );
            return (
              <tr class="border-t align-top">
                <td class="p-2">
                  {r.hasImage ? (
                    <a href={`/admin/richmenus/${r.richMenuId}/content`} target="_blank">
                      <img
                        src={`/admin/richmenus/${r.richMenuId}/content`}
                        alt=""
                        class="w-20 h-auto"
                      />
                    </a>
                  ) : (
                    <form
                      hx-post={`/admin/richmenus/${r.richMenuId}/upload`}
                      hx-target="body"
                      hx-swap="outerHTML"
                      hx-encoding="multipart/form-data"
                      class="flex flex-col gap-1"
                    >
                      <input
                        type="file"
                        name="image"
                        accept="image/png,image/jpeg"
                        required
                        class="text-xs"
                      />
                      <button class="text-xs bg-slate-700 text-white px-2 py-1 rounded">
                        Upload
                      </button>
                    </form>
                  )}
                </td>
                <td class="p-2 text-xs">{r.channelName}</td>
                <td class="p-2">{r.name}</td>
                <td class="p-2 text-xs">
                  {r.size.width}×{r.size.height}
                </td>
                <td class="p-2 text-xs">{r.areaCount}</td>
                <td class="p-2 text-xs">{r.linkedUsers}</td>
                <td class="p-2">
                  {r.isDefault ? (
                    <span class="text-green-700 font-semibold">●</span>
                  ) : (
                    <form
                      hx-post={`/admin/richmenus/${r.richMenuId}/set-default`}
                      hx-target="body"
                      hx-swap="outerHTML"
                    >
                      <button class="text-xs text-slate-600 hover:underline">
                        Set
                      </button>
                    </form>
                  )}
                </td>
                <td class="p-2 text-xs font-mono break-all">{r.richMenuId}</td>
                <td class="p-2">
                  <div class="flex flex-col gap-1">
                    <form
                      hx-post={`/admin/richmenus/${r.richMenuId}/link`}
                      hx-target="body"
                      hx-swap="outerHTML"
                      class="flex gap-1 text-xs"
                    >
                      <select name="virtualUserDbId" class="border rounded">
                        {channelUsers.map((u) => (
                          <option value={String(u.dbId)}>{u.displayName}</option>
                        ))}
                      </select>
                      <button class="text-green-700 hover:underline">Link</button>
                    </form>
                    <form
                      hx-delete={`/admin/richmenus/${r.richMenuId}`}
                      hx-confirm="Delete this rich menu?"
                      hx-target="body"
                      hx-swap="outerHTML"
                    >
                      <button class="text-red-600 text-xs hover:underline">
                        Delete
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </Layout>
);
```

- [ ] **Step 2: Wire up admin routes**

Edit `src/admin/routes.tsx`. Add imports:

```ts
import {
  richMenus,
  richMenuImages,
  userRichMenuLinks,
} from "../db/schema.js";
import { RichMenus } from "./pages/RichMenus.js";
import { richMenuId as makeRichMenuId } from "../lib/id.js";
```

Also ensure `and` is imported from `drizzle-orm` (check the existing import block — add `and` if missing; existing file has `eq, inArray, and, desc`).

Then append these handlers at the end of the file:

```ts
adminRouter.get("/admin/richmenus", async (c) => {
  const allChannels = await db
    .select({ id: channels.id, name: channels.name, defaultRichMenuId: channels.defaultRichMenuId })
    .from(channels);
  const channelById = new Map(allChannels.map((c) => [c.id, c]));

  const menuRows = await db.select().from(richMenus);
  const imageIds = new Set(
    (
      await db.select({ id: richMenuImages.richMenuId }).from(richMenuImages)
    ).map((r) => r.id)
  );
  const linkCounts = new Map<number, number>();
  const linkRows = await db
    .select({ internalId: userRichMenuLinks.richMenuId })
    .from(userRichMenuLinks);
  for (const r of linkRows) {
    linkCounts.set(r.internalId, (linkCounts.get(r.internalId) ?? 0) + 1);
  }

  const viewRows = menuRows.map((r) => {
    const p = r.payload as any;
    const ch = channelById.get(r.channelId);
    return {
      richMenuId: r.richMenuId,
      channelDbId: r.channelId,
      channelName: ch?.name ?? "?",
      name: String(p.name ?? ""),
      chatBarText: String(p.chatBarText ?? ""),
      size: {
        width: Number(p.size?.width ?? 0),
        height: Number(p.size?.height ?? 0),
      },
      areaCount: Array.isArray(p.areas) ? p.areas.length : 0,
      hasImage: imageIds.has(r.id),
      linkedUsers: linkCounts.get(r.id) ?? 0,
      isDefault: ch?.defaultRichMenuId === r.id,
    };
  });

  const userRows = await db
    .select({
      dbId: virtualUsers.id,
      userIdStr: virtualUsers.userId,
      displayName: virtualUsers.displayName,
      channelDbId: channelFriends.channelId,
    })
    .from(channelFriends)
    .innerJoin(virtualUsers, eq(channelFriends.userId, virtualUsers.id));

  return c.html(
    <RichMenus
      rows={viewRows}
      channels={allChannels.map((c) => ({ id: c.id, name: c.name }))}
      users={userRows}
    />
  );
});

adminRouter.post("/admin/richmenus", async (c) => {
  const form = await c.req.parseBody();
  const channelId = Number(form.channelId);
  const jsonStr = String(form.json ?? "");
  if (!Number.isInteger(channelId) || channelId <= 0) {
    return c.text("Invalid channelId", 400);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return c.text("Invalid JSON", 400);
  }
  const newId = makeRichMenuId();
  await db.insert(richMenus).values({
    richMenuId: newId,
    channelId,
    payload: { ...parsed, richMenuId: newId },
  });
  return c.redirect("/admin/richmenus");
});

adminRouter.get("/admin/richmenus/:richMenuId/content", async (c) => {
  const id = c.req.param("richMenuId");
  const rows = await db
    .select({
      internalId: richMenus.id,
      contentType: richMenuImages.contentType,
      data: richMenuImages.data,
    })
    .from(richMenus)
    .leftJoin(richMenuImages, eq(richMenus.id, richMenuImages.richMenuId))
    .where(eq(richMenus.richMenuId, id))
    .limit(1);
  const row = rows[0];
  if (!row?.data || !row.contentType) return c.notFound();
  c.header("Content-Type", row.contentType);
  return c.body(row.data as unknown as ArrayBuffer);
});

adminRouter.post("/admin/richmenus/:richMenuId/upload", async (c) => {
  const id = c.req.param("richMenuId");
  const form = await c.req.parseBody();
  const file = form.image;
  if (!(file instanceof File)) {
    return c.text("No image uploaded", 400);
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type.toLowerCase();
  if (mime !== "image/png" && mime !== "image/jpeg") {
    return c.text("Only image/png or image/jpeg accepted", 400);
  }
  if (buf.length > 1_048_576) {
    return c.text("Image must be <= 1 MB", 400);
  }
  const [rm] = await db
    .select({ internalId: richMenus.id })
    .from(richMenus)
    .where(eq(richMenus.richMenuId, id))
    .limit(1);
  if (!rm) return c.text("Rich menu not found", 404);
  await db
    .delete(richMenuImages)
    .where(eq(richMenuImages.richMenuId, rm.internalId));
  await db.insert(richMenuImages).values({
    richMenuId: rm.internalId,
    contentType: mime,
    data: buf,
  });
  return c.redirect("/admin/richmenus");
});

adminRouter.post("/admin/richmenus/:richMenuId/set-default", async (c) => {
  const id = c.req.param("richMenuId");
  const [rm] = await db
    .select({ internalId: richMenus.id, channelDbId: richMenus.channelId })
    .from(richMenus)
    .where(eq(richMenus.richMenuId, id))
    .limit(1);
  if (!rm) return c.text("Not found", 404);
  await db
    .update(channels)
    .set({ defaultRichMenuId: rm.internalId })
    .where(eq(channels.id, rm.channelDbId));
  return c.redirect("/admin/richmenus");
});

adminRouter.post("/admin/richmenus/:richMenuId/link", async (c) => {
  const id = c.req.param("richMenuId");
  const form = await c.req.parseBody();
  const userDbId = Number(form.virtualUserDbId);
  if (!Number.isInteger(userDbId) || userDbId <= 0) {
    return c.text("Invalid user", 400);
  }
  const [rm] = await db
    .select({ internalId: richMenus.id, channelDbId: richMenus.channelId })
    .from(richMenus)
    .where(eq(richMenus.richMenuId, id))
    .limit(1);
  if (!rm) return c.text("Not found", 404);
  await db
    .delete(userRichMenuLinks)
    .where(
      and(
        eq(userRichMenuLinks.channelId, rm.channelDbId),
        eq(userRichMenuLinks.userId, userDbId)
      )
    );
  await db.insert(userRichMenuLinks).values({
    channelId: rm.channelDbId,
    userId: userDbId,
    richMenuId: rm.internalId,
  });
  return c.redirect("/admin/richmenus");
});

adminRouter.delete("/admin/richmenus/:richMenuId", async (c) => {
  const id = c.req.param("richMenuId");
  await db.delete(richMenus).where(eq(richMenus.richMenuId, id));
  return c.redirect("/admin/richmenus");
});
```

- [ ] **Step 3: Add nav link**

Edit `src/admin/pages/Layout.tsx`. In the `<nav>` block, add a Rich Menus link between Coupons and Webhooks:

```tsx
<a class="hover:underline" href="/admin/richmenus">Rich Menus</a>
```

Final nav:
```tsx
<nav class="flex gap-4 text-sm">
  <a class="hover:underline" href="/admin">Dashboard</a>
  <a class="hover:underline" href="/admin/channels">Channels</a>
  <a class="hover:underline" href="/admin/users">Users</a>
  <a class="hover:underline" href="/admin/coupons">Coupons</a>
  <a class="hover:underline" href="/admin/richmenus">Rich Menus</a>
  <a class="hover:underline" href="/admin/webhook-log">Webhooks</a>
  <a class="hover:underline" href="/admin/api-log">API Log</a>
  <a class="hover:underline" href="/docs" target="_blank">Swagger</a>
</nav>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/admin/pages/RichMenus.tsx src/admin/routes.tsx src/admin/pages/Layout.tsx
git commit -m "feat(line-api-mock): add Rich Menus admin UI page"
```

---

## Task 9: SDK compatibility test

**Files:**
- Create: `test/sdk-compat/rich-menu.test.ts`

- [ ] **Step 1: Create test**

Create `test/sdk-compat/rich-menu.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { serve, type ServerType } from "@hono/node-server";
import { messagingApi, messagingApiBlob } from "@line/bot-sdk";
import { startDb } from "../helpers/testcontainer.js";

const PNG_1x1 = Buffer.from(
  "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415408996360000000000500010D0A2DB40000000049454E44AE426082",
  "hex"
);

let container: StartedPostgreSqlContainer;
let server: ServerType;
let port: number;
let token: string;
let botUserId: string;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { oauthRouter } = await import("../../src/mock/oauth.js");
  const { richMenuRouter } = await import("../../src/mock/rich-menu.js");
  const { richMenuLinkRouter } = await import(
    "../../src/mock/rich-menu-link.js"
  );
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens, virtualUsers, channelFriends } =
    await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9600000001",
      channelSecret: randomHex(16),
      name: "RichMenu SDK Test",
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
    .values({ userId: botUserId, displayName: "SDK RM Tester" })
    .returning();
  await db
    .insert(channelFriends)
    .values({ channelId: ch.id, userId: u.id });

  const app = new Hono();
  app.route("/", oauthRouter);
  app.route("/", richMenuRouter);
  app.route("/", richMenuLinkRouter);
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      port = info.port;
      resolve();
    });
  });
}, 90_000);

afterAll(async () => {
  server?.close();
  await container.stop();
});

function apiClient() {
  return new messagingApi.MessagingApiClient({
    channelAccessToken: token,
    baseURL: `http://127.0.0.1:${port}`,
  });
}

function blobClient() {
  return new messagingApiBlob.MessagingApiBlobClient({
    channelAccessToken: token,
    baseURL: `http://127.0.0.1:${port}`,
  });
}

describe("@line/bot-sdk rich menu against mock", () => {
  it("createRichMenu + setRichMenuImage + linkRichMenuIdToUser", async () => {
    const client = apiClient();
    const created = await client.createRichMenu({
      size: { width: 2500, height: 1686 },
      selected: false,
      name: "SDK menu",
      chatBarText: "Tap",
      areas: [
        {
          bounds: { x: 0, y: 0, width: 2500, height: 1686 },
          action: { type: "postback", data: "a=1" },
        },
      ],
    });
    expect(created.richMenuId).toMatch(/^richmenu-[0-9a-f]{32}$/);

    const blob = blobClient();
    await blob.setRichMenuImage(
      created.richMenuId,
      new Blob([PNG_1x1], { type: "image/png" })
    );

    await client.linkRichMenuIdToUser(botUserId, created.richMenuId);

    const got = await client.getRichMenuIdOfUser(botUserId);
    expect(got.richMenuId).toBe(created.richMenuId);
  });

  it("getRichMenuList returns created menus", async () => {
    const client = apiClient();
    const list = await client.getRichMenuList();
    expect(list.richmenus.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run**

Run: `npm run test:sdk -- test/sdk-compat/rich-menu.test.ts`
Expected: both tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/sdk-compat/rich-menu.test.ts
git commit -m "test(line-api-mock): SDK compat for rich menu"
```

---

## Task 10: README update

- [ ] **Step 1: Update README**

Edit `line-api-mock/README.md`. Find:

```markdown
- Bot info / Followers IDs
```

After that line, add:

```markdown
- Rich menu (作成 / 検証 / 取得 / 一覧 / 削除 / 画像 / ユーザー link / default / bulk)
```

Then find:

```markdown
### 未実装 (呼ぶと 501 を返す)

- Rich menu / LIFF / Insight / Audience / MLS / Shop / module-attach
```

Change to:

```markdown
### 未実装 (呼ぶと 501 を返す)

- Rich menu alias / Rich menu batch / LIFF / Insight / Audience / MLS / Shop / module-attach
```

- [ ] **Step 2: Commit**

```bash
git add line-api-mock/README.md
git commit -m "docs(line-api-mock): mark rich menu (core+linking) as implemented"
```

---

## Task 11: Final verification

- [ ] **Step 1: Run full suite**

Run from `line-api-mock/`:
```bash
npm run typecheck && npm run test:unit && npm run test:integration && npm run test:sdk
```

Expected: all green.

- [ ] **Step 2: Confirm clean tree**

Run: `git status` → `nothing to commit, working tree clean`.

---

## Self-Review

**Spec coverage:**
- [x] 3 new tables + `defaultRichMenuId` column (Task 1)
- [x] `richMenuId()` generator (Task 2)
- [x] Core CRUD: create / validate / get / list / delete (Task 3)
- [x] Image upload/download with MIME + size validation (Task 4)
- [x] User link / unlink / get (Task 5)
- [x] Default set / get / unset (Task 5)
- [x] Bulk link / unlink with 500-max and silent unknown-userId skip (Task 6)
- [x] Image-less rich menu rejects link with 400 (Tasks 5, 6)
- [x] Channel isolation (all handlers via `c.get("channelDbId")`)
- [x] Mount + remove from not-implemented (Task 7)
- [x] Admin UI: list / create / upload / delete / set-default / link (Task 8)
- [x] SDK-compat test (Task 9)
- [x] README update (Task 10)

**Placeholders:** No TBD/TODO. Each step has concrete code or commands.

**Type consistency:**
- `richMenuRouter` / `richMenuLinkRouter` names consistent between export, test import, and mount site
- `RichMenuRow` / `ChannelOption` / `VirtualUserOption` interface names match between component definition and consumer
- `findRichMenuWithImage` / `findVirtualUser` helpers defined in Task 5 and reused in Task 6

**Scope:** Alias and Batch async remain out of scope (PR-2).
