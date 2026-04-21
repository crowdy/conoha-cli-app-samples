# line-api-mock: Validate / Followers / Bot-Info Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 7 endpoints (`/v2/bot/message/validate/*` x5, `/v2/bot/followers/ids`, `/v2/bot/info`) in `line-api-mock`, all mechanical and DB-migration-free.

**Architecture:** Two thin Hono routers (`validate.ts`, `bot-info.ts`) that reuse existing ajv middleware, the `channel_friends` table, and derive `/v2/bot/info` fields deterministically from existing `channels` columns.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, ajv, vitest, testcontainers.

**All work from `line-api-mock/`.**

---

## File Structure

**New files:**
- `src/mock/validate.ts` — router with 5 validate handlers
- `src/mock/bot-info.ts` — router with `/v2/bot/info` + `/v2/bot/followers/ids`
- `test/integration/validate.test.ts`
- `test/integration/bot-info.test.ts`

**Modified files:**
- `src/index.ts` — mount both new routers before `adminRouter`/`notImplementedRouter`
- `README.md` — implemented list

---

## Task 1: validate.ts — 5 validate endpoints

**Files:**
- Create: `src/mock/validate.ts`
- Modify: `src/index.ts`
- Create: `test/integration/validate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/integration/validate.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startDb } from "../helpers/testcontainer.js";

let container: StartedPostgreSqlContainer;
let app: any;
let token: string;

const ENDPOINTS = [
  "/v2/bot/message/validate/reply",
  "/v2/bot/message/validate/push",
  "/v2/bot/message/validate/multicast",
  "/v2/bot/message/validate/narrowcast",
  "/v2/bot/message/validate/broadcast",
] as const;

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { validateRouter } = await import("../../src/mock/validate.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens } = await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  const [ch] = await db
    .insert(channels)
    .values({
      channelId: "9300000001",
      channelSecret: randomHex(16),
      name: "Validate Test",
    })
    .returning();
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  app = new Hono();
  app.route("/", validateRouter);
}, 60_000);

afterAll(async () => container.stop());

describe.each(ENDPOINTS)("POST %s", (path) => {
  it("accepts valid text messages with 200", async () => {
    const res = await app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages: [{ type: "text", text: "hi" }] }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects unknown message type with 400", async () => {
    const res = await app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages: [{ type: "bogus" }] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing bearer with 401", async () => {
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ type: "text", text: "hi" }] }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npm run test:integration -- test/integration/validate.test.ts`
Expected: FAIL (`validateRouter` not exported).

- [ ] **Step 3: Create the router**

Create `src/mock/validate.ts`:

```ts
import { Hono } from "hono";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { validate } from "./middleware/validate.js";

export const validateRouter = new Hono<{ Variables: AuthVars }>();

validateRouter.use("/v2/bot/message/validate/*", requestLog);
validateRouter.use("/v2/bot/message/validate/*", bearerAuth);

const PATHS = [
  "/v2/bot/message/validate/reply",
  "/v2/bot/message/validate/push",
  "/v2/bot/message/validate/multicast",
  "/v2/bot/message/validate/narrowcast",
  "/v2/bot/message/validate/broadcast",
] as const;

for (const p of PATHS) {
  validateRouter.post(
    p,
    validate({ requestSchema: "#/components/schemas/ValidateMessageRequest" }),
    (c) => c.body(null, 200)
  );
}
```

- [ ] **Step 4: Mount in src/index.ts**

Edit `src/index.ts`:
- Add `import { validateRouter } from "./mock/validate.js";` near other mock imports.
- Add `app.route("/", validateRouter);` right after `app.route("/", couponRouter);` and before `app.route("/", adminRouter);`.

- [ ] **Step 5: Run test — expect pass**

Run: `npm run test:integration -- test/integration/validate.test.ts`
Expected: 5 paths x 3 tests = 15 passing.

- [ ] **Step 6: Commit**

```bash
git add src/mock/validate.ts src/index.ts test/integration/validate.test.ts
git commit -m "feat(line-api-mock): implement /v2/bot/message/validate/* endpoints"
```

---

## Task 2: bot-info.ts — /v2/bot/info + /v2/bot/followers/ids

**Files:**
- Create: `src/mock/bot-info.ts`
- Modify: `src/index.ts`
- Create: `test/integration/bot-info.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/integration/bot-info.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startDb } from "../helpers/testcontainer.js";

let container: StartedPostgreSqlContainer;
let app: any;
let token: string;
let channelId: string;
let friendUserIds: string[];

beforeAll(async () => {
  container = await startDb();
  const { Hono } = await import("hono");
  const { botInfoRouter } = await import("../../src/mock/bot-info.js");
  const { db } = await import("../../src/db/client.js");
  const { channels, accessTokens, virtualUsers, channelFriends } =
    await import("../../src/db/schema.js");
  const { randomHex, accessTokenStr } = await import("../../src/lib/id.js");

  channelId = "9400000001";
  const [ch] = await db
    .insert(channels)
    .values({
      channelId,
      channelSecret: randomHex(16),
      name: "Bot Info Test",
    })
    .returning();
  token = accessTokenStr();
  await db.insert(accessTokens).values({
    channelId: ch.id,
    token,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  // Three friends: one blocked, two active.
  friendUserIds = [];
  for (let i = 0; i < 3; i++) {
    const userId = "U" + randomHex(16);
    friendUserIds.push(userId);
    const [u] = await db
      .insert(virtualUsers)
      .values({ userId, displayName: `Friend ${i}` })
      .returning();
    await db.insert(channelFriends).values({
      channelId: ch.id,
      userId: u.id,
      blocked: i === 0, // index 0 is blocked
    });
  }

  app = new Hono();
  app.route("/", botInfoRouter);
});

afterAll(async () => container.stop());

describe("GET /v2/bot/info", () => {
  it("returns deterministic bot info derived from channel", async () => {
    const res = await app.request("/v2/bot/info", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toMatch(/^U[0-9a-f]{32}$/);
    expect(body.basicId).toBe("@" + channelId.slice(0, 8));
    expect(body.displayName).toBe("Bot Info Test");
    expect(body.chatMode).toBe("chat");
    expect(body.markAsReadMode).toBe("auto");
  });

  it("rejects missing bearer", async () => {
    const res = await app.request("/v2/bot/info");
    expect(res.status).toBe(401);
  });
});

describe("GET /v2/bot/followers/ids", () => {
  it("returns non-blocked friends' userIds", async () => {
    const res = await app.request("/v2/bot/followers/ids", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.userIds)).toBe(true);
    expect(body.userIds).toHaveLength(2);
    expect(body.userIds).not.toContain(friendUserIds[0]); // blocked
    expect(body.userIds).toContain(friendUserIds[1]);
    expect(body.userIds).toContain(friendUserIds[2]);
    expect(body.next).toBeUndefined();
  });

  it("respects limit query parameter", async () => {
    const res = await app.request("/v2/bot/followers/ids?limit=1", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userIds).toHaveLength(1);
  });

  it("rejects limit > 1000 with 400", async () => {
    const res = await app.request("/v2/bot/followers/ids?limit=1001", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing bearer", async () => {
    const res = await app.request("/v2/bot/followers/ids");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npm run test:integration -- test/integration/bot-info.test.ts`
Expected: FAIL (`botInfoRouter` not exported).

- [ ] **Step 3: Create the router**

Create `src/mock/bot-info.ts`:

```ts
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db/client.js";
import { channels, channelFriends, virtualUsers } from "../db/schema.js";
import { bearerAuth, type AuthVars } from "./middleware/auth.js";
import { requestLog } from "./middleware/request-log.js";
import { errors } from "../lib/errors.js";

export const botInfoRouter = new Hono<{ Variables: AuthVars }>();
botInfoRouter.use("/v2/bot/info", requestLog);
botInfoRouter.use("/v2/bot/info", bearerAuth);
botInfoRouter.use("/v2/bot/followers/*", requestLog);
botInfoRouter.use("/v2/bot/followers/*", bearerAuth);

function deriveBotUserId(channelId: string): string {
  return "U" + createHash("sha256").update(channelId).digest("hex").slice(0, 32);
}

botInfoRouter.get("/v2/bot/info", async (c) => {
  const channelDbId = c.get("channelDbId");
  const [ch] = await db
    .select({
      channelId: channels.channelId,
      name: channels.name,
    })
    .from(channels)
    .where(eq(channels.id, channelDbId))
    .limit(1);
  if (!ch) return errors.notFound(c);
  return c.json({
    userId: deriveBotUserId(ch.channelId),
    basicId: "@" + ch.channelId.slice(0, 8),
    displayName: ch.name,
    chatMode: "chat",
    markAsReadMode: "auto",
  });
});

botInfoRouter.get("/v2/bot/followers/ids", async (c) => {
  const channelDbId = c.get("channelDbId");
  const limitStr = c.req.query("limit");
  let limit = 300;
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      return errors.badRequest(c, "limit must be an integer in [1, 1000]");
    }
    limit = n;
  }
  const rows = await db
    .select({ userId: virtualUsers.userId })
    .from(channelFriends)
    .innerJoin(virtualUsers, eq(channelFriends.userId, virtualUsers.id))
    .where(
      and(
        eq(channelFriends.channelId, channelDbId),
        eq(channelFriends.blocked, false)
      )
    )
    .limit(limit);
  return c.json({ userIds: rows.map((r) => r.userId) });
});
```

- [ ] **Step 4: Mount in src/index.ts**

Add `import { botInfoRouter } from "./mock/bot-info.js";` near other imports, and add `app.route("/", botInfoRouter);` right after `app.route("/", validateRouter);`.

- [ ] **Step 5: Run test — expect pass**

Run: `npm run test:integration -- test/integration/bot-info.test.ts`
Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/mock/bot-info.ts src/index.ts test/integration/bot-info.test.ts
git commit -m "feat(line-api-mock): implement /v2/bot/info + /v2/bot/followers/ids"
```

---

## Task 3: Update README

**File:** Modify `README.md` (in `line-api-mock/`)

- [ ] **Step 1: Edit the implemented list**

Find in `line-api-mock/README.md`:
```markdown
- Coupon (作成 / 一覧 / 詳細 / close、`type:"coupon"` メッセージ)
```

After that line, add:
```markdown
- Message validate (reply / push / multicast / narrowcast / broadcast)
- Bot info / Followers IDs
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(line-api-mock): mark validate/botinfo/followers as implemented"
```

---

## Task 4: Final verification

- [ ] **Step 1: Full suite**

Run from `line-api-mock/`:
```bash
npm run typecheck && npm run test:unit && npm run test:integration && npm run test:sdk
```

Expected: all green, no regressions.

- [ ] **Step 2: Confirm tree clean**

Run: `git status` → `nothing to commit, working tree clean`.

---

## Self-Review Summary

**Spec coverage:**
- [x] 5 validate endpoints (Task 1)
- [x] `/v2/bot/followers/ids` with limit + blocked-exclusion + next omission (Task 2)
- [x] `/v2/bot/info` with deterministic derivation (Task 2)
- [x] README update (Task 3)

**Placeholders:** none. Every step has complete code or commands.

**Type consistency:** `validateRouter`/`botInfoRouter` names match between module export, test import, and mount site in `src/index.ts`.

**Scope:** No migration needed, no new DB columns, no admin UI changes. Tight focused PR.
