# line-api-mock: Rich Menu Alias + Batch 実装設計 (PR-2)

- **対象プロジェクト**: `line-api-mock/`
- **作成日**: 2026-04-21
- **スコープ**: Rich Menu の Alias (5 paths) + Batch async (3 paths) = **8 endpoints**
- **前提**: PR-1 (Rich Menu Core + Linking, 15 paths) は main に既にマージ済み (commit `3f656eb`)
- **成果**: 実装済 31 → 39 / 64 paths

## 背景

PR-1 spec (`docs/superpowers/specs/2026-04-21-line-api-mock-richmenu-design.md`) で Rich Menu 機能を 2 PR に分割した。本 spec はその後半 (PR-2)。残る 8 endpoints は以下 2 領域に分かれる:

- **Alias**: `richMenuAliasId` (文字列) を `richMenuId` に紐付ける参照レイヤ。チャネル内で unique
- **Batch async**: 複数ユーザの rich menu 割当てを一括変更。実 LINE は非同期処理 + progress polling

## 設計判断サマリー

ブレインストーミングで以下 4 点を確定:

1. **Batch async 忠実度**: narrowcast stub と同じパターン — 即時同期処理 + `X-Line-Request-Id` ヘッダ + progress は常に `succeeded`
2. **Alias データモデル**: 複合 PK `(channelId, aliasId)` 単一テーブル、`richMenuId` FK は `ON DELETE CASCADE`
3. **Batch operations 意味論**: 順次適用・未知 ID は silent skip・ロールバックなし (bulk link/unlink と一貫)
4. **管理 UI 追加なし**: API のみ。README のみ更新

## データモデル

`src/db/schema.ts` に 1 テーブル追加。

```ts
export const richMenuAliases = pgTable(
  "rich_menu_aliases",
  {
    channelId: integer("channel_id").notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    aliasId: text("alias_id").notNull(),
    richMenuId: integer("rich_menu_id").notNull()
      .references(() => richMenus.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.channelId, t.aliasId] }) })
);
```

### 設計根拠

- **複合 PK `(channelId, aliasId)`**: 実 LINE は aliasId を「チャネル単位で unique」と規定。DB 制約で正確に表現し、アプリ層での重複チェックを不要にする
- **`richMenuId` FK → cascade**: alias は richMenu がなければ意味を持たない。PR-1 の `channels.defaultRichMenuId` が `set null` なのとは対照的 (default は「未指定」状態が存在するが、alias は存在自体が richMenu への参照)
- **Batch は stateless**: 新規テーブル不要。requestId は応答ヘッダに乗せるだけで追跡しない (narrowcast と一貫)

## API エンドポイント (8)

### `src/mock/rich-menu-alias.ts` — Alias (5)

| # | Method | Path | 動作 |
|---|---|---|---|
| 1 | POST | `/v2/bot/richmenu/alias` | ajv `CreateRichMenuAliasRequest` 検証 → aliasId 重複時 400 → richMenu 存在確認 (channel スコープ) → insert → 200 `{}` |
| 2 | GET | `/v2/bot/richmenu/alias/list` | `{ aliases: [{richMenuAliasId, richMenuId}] }` |
| 3 | GET | `/v2/bot/richmenu/alias/:aliasId` | `{ richMenuAliasId, richMenuId }` or 404 |
| 4 | POST | `/v2/bot/richmenu/alias/:aliasId` | `UpdateRichMenuAliasRequest` 検証 → alias 存在確認 → 新 richMenuId 存在確認 → update → 200 `{}` |
| 5 | DELETE | `/v2/bot/richmenu/alias/:aliasId` | 削除、未存在は 400 (実 API 仕様に合わせる) |

**ルーティング注意**: Hono は登録順でマッチするため、`/alias/list` を `/alias/:aliasId` より先に登録する必要がある (PR-1 の `/user/all/richmenu` と同じパターン)。

### `src/mock/rich-menu-batch.ts` — Batch async (3)

| # | Method | Path | 動作 |
|---|---|---|---|
| 6 | POST | `/v2/bot/richmenu/validate/batch` | ajv `RichMenuBatchRequest` 形式検証のみ → 200 empty body |
| 7 | POST | `/v2/bot/richmenu/batch` | 検証 → operations 順次適用 (link/unlink/unlinkAll) → `X-Line-Request-Id` ヘッダ → 202 `{}` |
| 8 | GET | `/v2/bot/richmenu/progress/batch?requestId=...` | 常に `{ phase: "succeeded", acceptedTime, completedTime }` |

### 共通仕様

- 全エンドポイントが `bearerAuth` + `requestLog` ミドルウェアを通過
- **チャネル境界**: 全クエリで `c.get("channelDbId")` を条件に含める。他チャネルの alias / richMenu は 404
- **aliasId 形式**: `^[a-z0-9_-]{1,32}$` (OpenAPI `pattern` を ajv が自動チェック)
- **ajv validation middleware**: 既存 `src/mock/middleware/validate.ts` を使用 (`requestSchema` / `responseSchema`)
- **requestId 生成**: PR-1 narrowcast と同じ `Math.random().toString(16).slice(2) + ...` で 32 hex (実 API の request-id はランダム UUID 様文字列だが、SDK は形式を検証しないため問題なし)
- **alias 対象 richMenu の画像チェックは行わない**: LINE 公式ドキュメントに alias 紐付け時の画像要件は明記されていない。PR-1 の user link / default は「画像なしは 400」としたが、alias はメタ参照レイヤであり画像表示とは独立のため、存在のみ確認する。画像が無い状態で alias 経由で link された場合の挙動は link エンドポイント側で既に 400 となるため重複検証は不要

### Batch operations 意味論 (詳細)

OpenAPI の `RichMenuBatchOperation` は discriminator (`type`) で 3 種に分岐:

- **`link`** (`RichMenuBatchLinkOperation`, required: `from`, `to`)
  - `from` richMenu に現在 link されている全ユーザの rich menu を `to` に入れ替え
  - `from` / `to` のいずれかが DB 上に存在しないか画像なしの場合 → **silent skip**
  - SQL: `UPDATE user_rich_menu_links SET rich_menu_id = to_id WHERE channel_id = ? AND rich_menu_id = from_id`

- **`unlink`** (`RichMenuBatchUnlinkOperation`, required: `from`)
  - `from` richMenu に link されている全ユーザを unlink
  - `from` 未存在 → silent skip
  - SQL: `DELETE FROM user_rich_menu_links WHERE channel_id = ? AND rich_menu_id = from_id`

- **`unlinkAll`** (`RichMenuBatchUnlinkAllOperation`, 追加フィールドなし)
  - 該当チャネル内の user-rich-menu 全 link を削除
  - SQL: `DELETE FROM user_rich_menu_links WHERE channel_id = ?`

- **トランザクションなし**: 各 operation を独立 SQL として順次実行。途中失敗時のロールバックは行わない (narrowcast / bulk と一貫)
- **`resumeRequestKey`**: 受け取るが無視 (実 API のリトライキーはサーバ状態依存のため mock では意味を持たない)
- **`operations` 空配列は 400**: OpenAPI で `required: [operations]` 指定だが、空配列でも通ってしまうので明示チェック。`maxItems: 1000` も ajv が処理

## Drizzle マイグレーション

`drizzle/0004_*.sql` が自動生成される想定。要確認事項:

- `rich_menu_aliases` CREATE TABLE
- 複合 PK 制約
- FK (`channel_id` → `channels.id`, `rich_menu_id` → `rich_menus.id`) の ON DELETE CASCADE

既存 richMenu/alias の cascade チェーン:
```
channels DELETE
  → rich_menus CASCADE
    → rich_menu_images CASCADE
    → rich_menu_aliases CASCADE
    → user_rich_menu_links CASCADE
```

`rich_menus` 単体削除時の cascade も同様 (`channels.defaultRichMenuId` は別途 `set null`)。

## テスト

### Integration

**`test/integration/rich-menu-alias.test.ts`** — 以下フローを検証:
- 作成 → list → 個別取得 → update (richMenuId 変更) → 取得で新 richMenuId → delete → 404
- aliasId 重複 → 400
- 存在しない richMenuId で create → 400
- 存在しない alias に対する update / delete → それぞれ 400 / 400
- aliasId 形式違反 (大文字含む等) → 400 (ajv)
- **channel isolation**: チャネル A で作った alias は チャネル B からは 404
- **cascade**: richMenu 削除時に alias 行も消える
- **cascade**: channel 削除時に alias 行も消える

**`test/integration/rich-menu-batch.test.ts`**:
- `POST /batch` with `link` operation → 該当 from→to 更新を確認
- `POST /batch` with `unlink` → 該当 link 削除を確認
- `POST /batch` with `unlinkAll` → channel 内全 link 削除
- 複数 operation 混在 → 順次適用
- 未知 `from` の operation は silent skip (他 operation 正常適用)
- レスポンスに `X-Line-Request-Id` ヘッダが存在
- `POST /validate/batch` で shape OK → 200 empty
- `POST /validate/batch` で不正形式 (type missing 等) → 400
- 空 `operations` 配列 → 400
- `operations.length > 1000` → 400 (ajv)
- `GET /progress/batch?requestId=...` → `phase: "succeeded"` 固定
- **channel isolation**: 他チャネルの richMenuId を `from` に指定 → silent skip (当該チャネルの link は変わらない)

### SDK-compat

**既存 `test/sdk-compat/rich-menu.test.ts` に追加** (新規ファイルなし):
- `createRichMenuAlias({ richMenuAliasId, richMenuId })` → 200
- `getRichMenuAlias(aliasId)` → shape 一致
- `getRichMenuAliasList()` → `{ aliases: [...] }` shape 一致
- `updateRichMenuAlias(aliasId, { richMenuId })` → 200
- `deleteRichMenuAlias(aliasId)` → 200
- `richMenuBatch({ operations: [...] })` → 202
- `validateRichMenuBatchRequest({ operations: [...] })` → 200
- `getRichMenuBatchProgress(requestId)` → `{ phase, acceptedTime, completedTime }` shape 一致

### Unit

なし — ajv 検証と DB クエリのみで、純粋ロジックが存在しない。

### e2e

省略 (PR-1 と同じ理由 — mock の価値に対して過剰)。

## ファイル構成

**新規作成:**
- `src/mock/rich-menu-alias.ts` — Alias 5 endpoints
- `src/mock/rich-menu-batch.ts` — Batch 3 endpoints
- `test/integration/rich-menu-alias.test.ts`
- `test/integration/rich-menu-batch.test.ts`
- `drizzle/0004_*.sql` (自動生成)

**変更:**
- `src/db/schema.ts` — `richMenuAliases` テーブル追加
- `src/index.ts` — 2 router を mount
- `test/sdk-compat/rich-menu.test.ts` — Alias + Batch の 8 メソッド追加
- `line-api-mock/README.md` — 実装済/未実装リスト更新 (39/64)

## セキュリティ / 制約事項

- alias は権限制約なし (channel 境界のみ)。PR-1 と同じレベル
- Batch の operations 1000 件上限は OpenAPI `maxItems` に従う (ajv 処理)
- requestId は形式的に 32 hex を返すが**ランダムで再現性なし** (progress はどの requestId でも `succeeded` を返す stateless 設計のため、これで問題にならない)
- トランザクション不使用のため、Batch 途中で DB 障害が起きた場合の部分適用状態はリカバリされない (mock の責務外)

## 実装順序 (plan 作成ヒント)

1. Drizzle schema + マイグレーション (`richMenuAliases` 1 テーブル)
2. Alias router 骨組み + bearerAuth/requestLog middleware
3. Alias create / get / list + integration test
4. Alias update / delete + integration test
5. Alias channel isolation + cascade test
6. Batch router 骨組み
7. Batch validate + POST /batch (operations 適用) + integration test
8. Batch progress + requestId ヘッダ + integration test
9. `src/index.ts` で 2 router mount
10. SDK-compat 追加 (既存 rich-menu.test.ts に 8 メソッド)
11. README 更新
