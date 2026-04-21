# line-api-mock: Rich Menu (Core CRUD + Linking) 実装設計

- **対象プロジェクト**: `line-api-mock/`
- **作成日**: 2026-04-21
- **スコープ**: LINE Messaging API Rich Menu 機能のうち「Core CRUD + Linking + 管理 UI」を実装する (PR-1)
- **非スコープ**: Alias (5 paths) / Batch async (3 paths) は PR-2 に分割

## 背景

`line-api-mock` は現在 23/64 paths 実装済み。Rich Menu は LINE 公式アカウントの UX の核であり、SDK 統合テストでよく呼ばれるため優先度が高い。ただし 23 endpoints + 画像アップロード/ダウンロード + 非同期バッチ を一度に実装すると PR 規模が過大になるため、**Core CRUD + User Linking + 管理 UI を PR-1** に、**Alias + Batch async を PR-2** に分割する。本 spec は PR-1 のみを扱う。

## 設計判断サマリー

ブレインストーミングで以下 4 点を確定:

1. **スコープ分割**: 2 PR (本 spec = PR-1)
2. **画像保存**: Postgres `bytea` カラム (既存 `message_contents` と同パターン)
3. **管理 UI**: 中程度 UI — raw JSON で作成 + 画像アップロード / リスト / 詳細 / 削除 / link / default 設定
4. **画像検証**: MIME (`image/png` または `image/jpeg`) + サイズ (≤1MB) のみ。ピクセル治数は検証しない (依存追加を避けるため)

## データモデル

`src/db/schema.ts` に 3 テーブル追加 + 1 カラム追加。

```ts
// Rich menu メタデータ — チャネルスコープ
export const richMenus = pgTable("rich_menus", {
  id: serial("id").primaryKey(),
  richMenuId: text("rich_menu_id").notNull().unique(),  // "richmenu-" + 32hex
  channelId: integer("channel_id").notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  payload: jsonb("payload").notNull(),                  // RichMenuResponse 全体
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull().defaultNow(),
});

// 画像データ (bytea) — リスト時に積まれないよう分離
export const richMenuImages = pgTable("rich_menu_images", {
  richMenuId: integer("rich_menu_id").primaryKey()
    .references(() => richMenus.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
});

// user → richMenu 関連 (1 user につき最大 1 link)
export const userRichMenuLinks = pgTable(
  "user_rich_menu_links",
  {
    channelId: integer("channel_id").notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull()
      .references(() => virtualUsers.id, { onDelete: "cascade" }),
    richMenuId: integer("rich_menu_id").notNull()
      .references(() => richMenus.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.channelId, t.userId] }) })
);
```

`channels` に追加:
```ts
defaultRichMenuId: integer("default_rich_menu_id")
  .references(() => richMenus.id, { onDelete: "set null" }),
```

`ON DELETE set null` により、リッチメニュー削除時は default 参照が自動クリア。

### 設計根拠

- **`rich_menu_images` を分離**: `richMenus` に `bytea` を混ぜると `select()` で常にバイナリが一緒に返る。リスト API はメタデータだけ必要なので分離してパフォーマンスと明示性を確保。
- **`user_rich_menu_links` PK を `(channelId, userId)`**: LINE 実 API でユーザーには同時に 1 つのリッチメニューしか割り当てられない。PK 制約でこれを保証。
- **`channels.defaultRichMenuId` をカラムとして追加**: 別テーブル化すると Nullable one-to-one を表現するのに INNER JOIN が増える。単純化のためカラムに置く。

## API エンドポイント (15)

2 ファイルに分割。

### `src/mock/rich-menu.ts` — Core CRUD + 画像

| # | Method | Path | 概要 |
|---|---|---|---|
| 1 | POST | `/v2/bot/richmenu` | ajv `RichMenuRequest` 検証 → `richmenu-` + 32hex 生成 → 挿入 |
| 2 | POST | `/v2/bot/richmenu/validate` | 検証のみ (200 empty body) |
| 3 | GET | `/v2/bot/richmenu/:richMenuId` | 詳細 (`RichMenuResponse`) |
| 4 | DELETE | `/v2/bot/richmenu/:richMenuId` | cascade で image / link も削除 |
| 5 | GET | `/v2/bot/richmenu/list` | `{ richmenus: [...] }` |
| 6 | POST | `/v2/bot/richmenu/:richMenuId/content` | MIME + size 検証 → bytea 保存。`Content-Type` ヘッダで判定 |
| 7 | GET | `/v2/bot/richmenu/:richMenuId/content` | bytea を `Content-Type` 設定して返却 |

### `src/mock/rich-menu-link.ts` — Linking

| # | Method | Path | 概要 |
|---|---|---|---|
| 8 | POST | `/v2/bot/user/:userId/richmenu/:richMenuId` | link (UPSERT) |
| 9 | DELETE | `/v2/bot/user/:userId/richmenu` | unlink |
| 10 | GET | `/v2/bot/user/:userId/richmenu` | `{ richMenuId }` (未 link は 404) |
| 11 | POST | `/v2/bot/user/all/richmenu/:richMenuId` | default 設定 |
| 12 | GET | `/v2/bot/user/all/richmenu` | `{ richMenuId }` (未設定は 404) |
| 13 | DELETE | `/v2/bot/user/all/richmenu` | default 解除 |
| 14 | POST | `/v2/bot/richmenu/bulk/link` | N 件一括 link |
| 15 | POST | `/v2/bot/richmenu/bulk/unlink` | N 件一括 unlink |

### 共通仕様

- 全エンドポイントが `bearerAuth` と `requestLog` ミドルウェアを通過
- チャネル境界: すべて `c.get("channelDbId")` でスコープ。他チャネルの ID アクセスは 404
- **画像なしリッチメニューへの user link は 400** (LINE 実 API と同挙動)
- `richMenuId` 形式: `"richmenu-" + crypto.randomBytes(16).toString("hex")`
- 画像 MIME 検証: request の `Content-Type` が `image/png` または `image/jpeg` 以外は 400
- 画像サイズ検証: request body length が 1 MB (1_048_576 bytes) 超は 400
- **Bulk link/unlink の挙動**: LINE 実 API は `202 Accepted` を返し非同期に処理する。mock は同期で処理するが返却は `202 {}` とし、**未知の userId は silently skip** (実 API のエラー通知は webhook / retry 機構であり mock では再現しない)

### Bulk link/unlink 制限
- `userIds` 長さ 500 超で 400 (LINE 実 API 制限に合わせる)
- 存在しない `richMenuId` (または画像なし) で 400

## 管理 UI

`src/admin/pages/RichMenus.tsx` 新設 + `src/admin/routes.tsx` にハンドラ追加 + Layout に Nav リンク。

### リスト画面 (`GET /admin/richmenus`)
- テーブル: 画像サムネ (img src に `/v2/bot/richmenu/.../content`) / name / size (2500x1686 or 2500x843) / areas 数 / 連結ユーザー数 / default 뱃지 / 所属 channel
- 行別アクション: **Delete** / **Set default** (同チャネルの default に切替) / **Unset default** / **Link to user** (チャネル内 virtualUsers からプルダウン選択)

### 作成フォーム (`<details>` 展開式)
- チャネル選択 (`<select>` from channels)
- `<textarea>` に `RichMenuRequest` JSON を貼り付け (placeholder に最小サンプル)
- **Submit** → `/admin/richmenus` に POST → ajv 検証通過なら DB 挿入 → リダイレクト
- **画像は別フォーム**: 作成後、リスト行に「Upload image」ボタンを追加 → `<input type="file">` を PUT する

### エラー時の UX
- ajv 検証失敗時は `errors.badRequest` が返す `{message, details}` を画面上部にバナー表示
- 画像ファイルサイズ超過は「Image must be ≤ 1 MB」
- MIME 不一致は「Only image/png and image/jpeg accepted」

## テスト

### Unit
- `test/unit/rich-menu-id.test.ts` — `richMenuId()` ジェネレータ (形式 `^richmenu-[0-9a-f]{32}$`)

### Integration
`test/integration/rich-menu.test.ts` — 以下フローを検証:
- 作成 → 一覧 → 詳細 → 削除
- 画像アップロード → ダウンロード (bytes 一致)
- MIME 不一致で 400、1MB 超で 400
- user link → 取得 → unlink → 取得 404
- 画像なしリッチメニューへの user link で 400
- default 設定 → 取得 → 解除 → 取得 404
- bulk link/unlink 正常系 + 不明ユーザー混在時の挙動
- **channel isolation**: 他チャネルの richMenuId で GET/DELETE は 404
- 削除 cascade: richMenu 削除時に image, user_rich_menu_links, channels.defaultRichMenuId が整合

### SDK-compat
`test/sdk-compat/rich-menu.test.ts` — `@line/bot-sdk` `MessagingApiClient`:
- `createRichMenu` + `setRichMenuImage` (Blob API) → 200
- `linkRichMenuIdToUser` → 200
- `getRichMenu` / `getRichMenuList` / `getDefaultRichMenuId` → shape 一致

### e2e
省略。整合性と関心に対しオーバーヘッドが大きい。

## Drizzle マイグレーション

`drizzle/0002_*.sql` が自動生成される。要確認事項:
- `richMenus`, `rich_menu_images`, `user_rich_menu_links` の CREATE TABLE
- `channels` への `default_rich_menu_id` カラム追加 (`ALTER TABLE`)
- FK 制約の ON DELETE 指定 (cascade / set null が正しく出ているか)

## ファイル構成

**新規作成:**
- `src/mock/rich-menu.ts` — Core CRUD + 画像 (7 endpoints)
- `src/mock/rich-menu-link.ts` — Linking (8 endpoints)
- `src/admin/pages/RichMenus.tsx` — 管理 UI page
- `test/unit/rich-menu-id.test.ts`
- `test/integration/rich-menu.test.ts`
- `test/sdk-compat/rich-menu.test.ts`
- `drizzle/0002_*.sql` (自動生成)

**変更:**
- `src/db/schema.ts` — 3 テーブル + 1 カラム追加
- `src/lib/id.ts` — `richMenuId()` ジェネレータ
- `src/mock/not-implemented.ts` — `richmenu` path を削除
- `src/index.ts` — 2 router を mount
- `src/admin/routes.tsx` — richmenus 関連ハンドラ
- `src/admin/pages/Layout.tsx` — nav link
- `line-api-mock/README.md` — 実装済み/未実装リスト更新

## セキュリティ / 制約事項

- 画像はチャネルごとに最大 1MB × 1000 個 ≒ 1GB 程度。ローカル開発用途なので許容。本番 mock 運用は想定外
- 管理 UI の create form は admin auth のみ (CSRF なし — 既存制限)
- MIME 検証は `Content-Type` ヘッダ信頼。実際のバイト内容が PNG かまでは検証しない (依存追加回避)

## 実装順序 (plan 作成ヒント)

1. Drizzle schema + マイグレーション
2. `richMenuId()` generator + unit test
3. Core CRUD (create / get / list / delete) + tests
4. 画像 upload/download + tests
5. Linking (user link/unlink/get + default) + tests
6. Bulk link/unlink + tests
7. 管理 UI (list + create form + image upload + delete/link/default ボタン)
8. not-implemented.ts から richmenu を除外 + index.ts に mount
9. SDK-compat test
10. README 更新
