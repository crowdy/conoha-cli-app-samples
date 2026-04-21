# line-api-mock: Validate / Followers / Bot-Info 実装設計

- **対象プロジェクト**: `line-api-mock/`
- **作成日**: 2026-04-21
- **スコープ**: LINE Messaging API の以下 7 エンドポイントを実装する
  - `POST /v2/bot/message/validate/{reply,push,multicast,narrowcast,broadcast}` (5)
  - `GET /v2/bot/followers/ids` (1)
  - `GET /v2/bot/info` (1)

## 背景

直近 PR (#24) でクーポン機能を実装した後、mock は 64 paths 中 16 paths のみ実装済み。優先度 1 (`validate/*` — SDK のメッセージ検証 dry-run でよく呼ばれる) と 2 (`followers/ids` / `info` — Bot プロビジョニングコードが初期化で呼ぶ) を同一 PR に束ねる。いずれも既存のスキーマ/テーブル再利用で済む軽量な追加で、新規テーブル・外部依存・マイグレーションは不要。

## 設計判断

### 1. Validate 5 エンドポイント
- すべて `requestBody` が `ValidateMessageRequest = { messages: Message[] }`、`responses.200` は空 (`description: "OK"`)
- **既存の ajv middleware を reuse する**。`src/mock/middleware/validate.ts` を `validate({ requestSchema: "#/components/schemas/ValidateMessageRequest" })` で呼び出すだけで schema 違反時に 400 を自動返却する
- ハンドラ本体は `c.body(null, 200)` (body 無し 200) のみ
- **副作用なし**: DB 書き込みも webhook 発火もしない — LINE 実 API もそのように定義されている

### 2. GET /v2/bot/followers/ids
- `channel_friends` テーブルを `blocked = false` で select し、`virtual_users.user_id` を配列化
- `start` クエリ token のサポートは最小限: 受け取りはするが無視して一括返す (mock はスケール不要)。`next` は必ず省略する
- `limit` クエリは尊重する (既定 300、上限 1000)。spec の enum に合わせて `limit > 1000` は 400 を返す
- 応答: `{ userIds: [...], next?: undefined }`

### 3. GET /v2/bot/info
- 現在の `channels` スキーマには `userId` / `basicId` / `chatMode` / `markAsReadMode` の対応カラムがない
- **マイグレーションを避けるため、既存カラムから決定論的に導出する**:
  - `userId` = `"U" + sha256(channelId).slice(0,32)` (ハッシュ 32 hex 文字 → LINE 互換の 33 文字長)
  - `basicId` = `"@" + channelId.slice(0, 8)`
  - `displayName` = `channels.name`
  - `pictureUrl` = 省略 (optional)
  - `chatMode` = 固定値 `"chat"`
  - `markAsReadMode` = 固定値 `"auto"`
- 固定値についてはテストで期待値を明記する

## 新規/変更ファイル

- Create: `src/mock/validate.ts` — 5 validate エンドポイントをまとめた Hono router
- Create: `src/mock/bot-info.ts` — `/v2/bot/info` と `/v2/bot/followers/ids` をまとめた Hono router
- Modify: `src/index.ts` — 2 router をマウント
- Modify: `line-api-mock/README.md` — 実装済みリストに追記
- Create: `test/integration/validate.test.ts`
- Create: `test/integration/bot-info.test.ts`

## テスト

- **validate**: 各エンドポイントについて (a) 正常な text メッセージで 200、(b) スキーマ違反 (例: unknown type) で 400、(c) 認証なしで 401。5 x 3 = 15 テストだが `it.each` で圧縮
- **followers/ids**: 友だち 3 人登録 → 3 件返る / `blocked=true` は除外 / `limit > 1000` で 400 / `limit=2` で 2 件のみ
- **bot/info**: `userId` が `^U[0-9a-f]{32}$` にマッチ / `basicId` が `@` + 先頭 8 文字 / `displayName == channel.name` / `chatMode=="chat"` / `markAsReadMode=="auto"`

## 非スコープ

- 優先度 3 (Rich menu) は別 PR・別 spec
- `validate/*` エンドポイントで将来的にレート制限やクォータを考慮する必要はない (mock)
- `/v2/bot/info` の動的設定 UI は追加しない (固定値で十分)
