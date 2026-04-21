# line-api-mock: クーポン機能 実装設計

- **対象プロジェクト**: `line-api-mock/`
- **作成日**: 2026-04-20
- **スコープ**: LINE Messaging API の公式クーポン機能（2025年8月追加）を本モックサーバーに実装する
- **非スコープ (除外済み)**: オートメッセージ機能。調査の結果、LINE Messaging API には該当エンドポイントが存在せず、LINE公式アカウントマネージャ管理画面、もしくはサードパーティソリューション（エルメ等）のクライアント側独自機能であるため、本モックサーバーの責務外とする。

## 背景

`line-api-mock` は LINE Messaging API OpenAPI 仕様に準拠したモックサーバーで、開発者が実 LINE に依存せず Bot を開発・テストするために用いる。クーポン API は 2025年8月に LINE が追加した比較的新しい機能であり、本プロジェクトで vendored している `specs/messaging-api.yml` にはスキーマおよびパスが既に定義済みである一方、サーバー実装は未着手（未実装パスを 501 で返す `not-implemented.ts` にも含まれておらず、現状は素の 404）。

本設計はこのギャップを埋め、`@line/bot-sdk` などの公式 SDK から `createCoupon` や `pushMessage({type:"coupon"})` をモックサーバー向けに呼び出した際に、LINE 実環境と同形式のレスポンスを返し、管理 UI から結果を視覚的に確認できる状態を実現する。

## 対応エンドポイント

OpenAPI 仕様 (`specs/messaging-api.yml` L1936-2075) で定義済み。

| Method | Path | 概要 |
|---|---|---|
| `POST` | `/v2/bot/coupon` | クーポン作成。body は `CouponCreateRequest`。返却は `{couponId}`。 |
| `GET` | `/v2/bot/coupon` | クーポン一覧。`status` / `limit` クエリ対応。返却は `{items:[{couponId,title}], next?}`。 |
| `GET` | `/v2/bot/coupon/{couponId}` | クーポン詳細。返却は `CouponResponse`。 |
| `PUT` | `/v2/bot/coupon/{couponId}/close` | クーポンを `CLOSED` に遷移。 |

加えて、既存のメッセージ送信エンドポイント群（push / reply / multicast / broadcast / narrowcast）で `type: "coupon"` の `CouponMessage` を受け付ける。

## データモデル

`src/db/schema.ts` に新規テーブル `coupons` を追加。

```ts
export const coupons = pgTable("coupons", {
  id: serial("id").primaryKey(),
  couponId: text("coupon_id").notNull().unique(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => channels.id, { onDelete: "cascade" }),
  payload: jsonb("payload").notNull(),   // CouponResponse 全体
  status: text("status").notNull().default("RUNNING"), // DRAFT | RUNNING | CLOSED
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

設計判断:
- `reward` / `acquisitionCondition` / `priceInfo` は OpenAPI 上すべて **discriminated union** であり、リレーショナル分解の利益がない。`CouponResponse` 全体を `jsonb` に保存し、取得時そのまま返却することで SDK 互換性を最も素直に確保できる。
- `status` のみカラム化することで、一覧クエリの `WHERE status = ?` フィルタを JSONB 経路にせずインデックス可能に保つ。
- クーポンメッセージ送信履歴は既存の `messages.payload` (`jsonb`) に `{type:"coupon", couponId}` をそのまま保存すれば十分で、新規テーブル不要。

Drizzle マイグレーションは `drizzle-kit generate` で 1 ファイル追加される。

## `couponId` 生成

LINE 実環境の形式（英数字の不透明 ID）に合わせ、`node:crypto` の `randomBytes` で 16 バイト → base64url → `COUPON_` プレフィックスで生成。既存の `messageId` 生成パターンに揃える。

## API 実装 (`src/mock/coupon.ts` 新設)

ルーティングとビジネスロジックを 1 ファイルに集約。既存の `src/mock/message.ts` と同等の粒度。

- チャンネル認証: 既存 `tokenAuth` ミドルウェアで `c.get("channelId")` 取得（token-to-channel の解決はすでに存在する）。
- リクエスト検証: 既存 `validate(CouponCreateRequest)` ajv ミドルウェアを使用。`specs/messaging-api.yml` からのスキーマ抽出は既存ビルドパイプラインで自動化済み。
- 固有バリデーション:
  - `startTimestamp < endTimestamp`（OpenAPI では強制されない）
  - `close` 時に当該チャンネル所有かつ `status != "CLOSED"`。二重 close は 400 を返す。
- エラー形式: 既存 `errors.ts` の LINE 互換エラー形式 (`{message, details?}`) を流用。

## クーポンメッセージ

`src/mock/message.ts` のメッセージ処理ループで `type: "coupon"` を扱う。OpenAPI の `CouponMessage` スキーマ (L4220-4232) がすでに `message` の `oneOf` に組み込まれているため、ajv 側の変更は不要。

固有ロジックのみ追加:
- 送信前に `couponId` が **当該チャンネルに属する** クーポンとして存在するかを確認。存在しなければ 400（`Invalid coupon ID`）。
- `status=CLOSED` のクーポンでも送信自体は許可する（LINE 実環境仕様に合わせる）。ただし管理 UI の配信ログで「CLOSED coupon」バッジを付与する。

## 管理 UI

`src/admin/pages/coupons.tsx` を新設し、チャンネル詳細ページのタブに **Coupons** を追加。

構成:
1. **一覧**: couponId / title / reward サマリ / status / 期間。`status` フィルタと検索。
2. **作成フォーム** (HTMX): `title`, `description`, `imageUrl`, `start/endTimestamp`（datetime-local → epoch sec 変換）, `timezone`（既定 `ASIA_TOKYO`）, `visibility`（既定 `UNLISTED`）, `maxUseCountPerTicket`（既定 1）。  
   `reward.type` はセレクトで選ばせ、`discount` / `cashBack` を優先的に UI 化し、`free` / `gift` / `others` は type のみで priceInfo 不要。  
   `acquisitionCondition.type` は `normal` / `lottery` を選択、`lottery` 時に確率・上限枚数フィールドを展開。
3. **詳細**: JSON pretty-print と **Close** ボタン。
4. **Conversations タブでの表示**: クーポンメッセージをカード形式でレンダ — 画像サムネ + title + reward の人間可読文字列（例: `10% 割引` / `¥500 キャッシュバック` / `無料`）。既存 XSS 対策（`escapeHtml`）を適用。

## 未実装ルートとの関係

`src/mock/not-implemented.ts` は `/v2/bot/coupon/*` を捕捉していないため、単にクーポンルーターを先に `app.route()` でマウントするだけで良い。追加の除外設定は不要。

## Webhook への影響

Bot → ユーザー方向のメッセージ（クーポン送信もここに該当）は LINE 実環境でも webhook 再送されないため、本設計での変更はない。ユーザー → Bot 方向の webhook イベントにクーポン関連の event type は存在しない。

## テスト

既存テスト階層（`test/unit`, `test/integration`, `test/sdk`, `test/e2e`）に沿って追加。

- **unit** (`test/unit/coupon-schema.test.ts`): `CouponCreateRequest` の必須フィールド欠落、discriminator 不整合、`startTimestamp >= endTimestamp`、`maxUseCountPerTicket > 1` のそれぞれで 400 が返ることを検証。
- **integration** (`test/integration/coupon.test.ts`): 
  - 作成 → 一覧 → 詳細 → close のハッピーパス
  - 他チャンネルの couponId を close しようとすると 404
  - 二重 close で 400
  - `type:"coupon"` push: 存在する couponId で 200、存在しない ID で 400
- **sdk** (`test/sdk/coupon.test.ts`): `@line/bot-sdk` の `MessagingApiClient.createCoupon` / `pushMessage({messages:[{type:"coupon", couponId}]})` がこのモック向けに成功すること。
- **e2e** (`test/e2e/coupon.spec.ts`): 管理 UI から作成 → Conversations で push → カード表示を確認する 1 シナリオに限定。

## セキュリティ上の注意

- 管理 UI の作成フォームで `imageUrl` / `barcodeImageUrl` をそのままレンダする箇所は既存の XSS 対策（`escapeHtml`）を適用する。
- Bot API は既存の `tokenAuth` に委譲するため、チャンネル境界違反は自然に防がれる（他チャンネルの couponId へアクセス不可）。

## ドキュメント更新

`line-api-mock/README.md` の「実装済み / 未実装」リストを更新し、`specs/README.md` の vendored 元コミット SHA はそのまま（スペックは既存）。

## 実装順序（plan 作成のヒント）

1. Drizzle schema + マイグレーション追加
2. `src/mock/coupon.ts` の 4 エンドポイント実装
3. `src/index.ts` でルーターをマウント
4. メッセージ送信側の `type:"coupon"` バリデーション分岐追加
5. 管理 UI（一覧 → 作成フォーム → 詳細/close → 会話内カード描画）
6. テスト各階層
7. README 更新

各ステップで段階的にテスト可能であるため、サブエージェント並列化の利益は小さい。単一フローで順次実装する方針を推奨する。
