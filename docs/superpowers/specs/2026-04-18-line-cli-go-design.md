# line-cli-go: LINE Messaging API CLI Client (Go)

## 概要

line-api-mock と通信する Go 製 CLI クライアント。LINE 公式 Go SDK (`line-bot-sdk-go` v8) を使用し、mock サーバーが実装している全エンドポイントをカバーする機能デモ CLI。

## 技術スタック

- **言語:** Go
- **LINE SDK:** `github.com/line/line-bot-sdk-go/v8` (OpenAPI 基盤自動生成クライアント)
- **CLI フレームワーク:** `github.com/spf13/cobra`
- **設定管理:** `github.com/spf13/viper` (env < config file < CLI flag)

## プロジェクト構造

```
line-cli-go/
├── main.go                     # エントリポイント
├── go.mod
├── go.sum
├── .env.example                # 設定例
├── README.md
├── cmd/
│   ├── root.go                 # ルートコマンド、グローバルフラグ(--base-url, --json, --config)
│   ├── token/
│   │   ├── token.go            # `token` サブコマンドグループ
│   │   ├── issue.go            # token issue (v2 client_credentials)
│   │   ├── issue_v3.go         # token issue-v3 (JWT ベース)
│   │   ├── verify.go           # token verify
│   │   ├── revoke.go           # token revoke
│   │   └── list_kids.go        # token list-kids (v3 key ID 一覧)
│   ├── message/
│   │   ├── message.go          # `message` サブコマンドグループ
│   │   ├── push.go             # message push
│   │   ├── reply.go            # message reply
│   │   ├── multicast.go        # message multicast
│   │   ├── broadcast.go        # message broadcast
│   │   └── narrowcast.go       # message narrowcast
│   ├── profile/
│   │   ├── profile.go          # `profile` サブコマンドグループ
│   │   └── get.go              # profile get
│   ├── webhook/
│   │   ├── webhook.go          # `webhook` サブコマンドグループ
│   │   ├── get.go              # webhook get
│   │   ├── set.go              # webhook set
│   │   └── test.go             # webhook test
│   ├── content/
│   │   ├── content.go          # `content` サブコマンドグループ
│   │   └── get.go              # content get
│   └── quota/
│       ├── quota.go            # `quota` サブコマンドグループ
│       ├── get.go              # quota get
│       └── consumption.go      # quota consumption
├── internal/
│   ├── config/
│   │   └── config.go           # 設定ロード (env < file < flag)
│   ├── client/
│   │   └── client.go           # line-bot-sdk-go クライアントファクトリ
│   └── output/
│       └── output.go           # テキスト/JSON 出力フォーマッター
└── docker-compose.yml          # (任意) line-api-mock を含む dev 環境
```

## 設定管理

### 設定項目

| キー | 環境変数 | CLI フラグ | 説明 | デフォルト |
|---|---|---|---|---|
| `base_url` | `LINE_BASE_URL` | `--base-url` | mock サーバーアドレス | `http://localhost:3000` |
| `channel_id` | `LINE_CHANNEL_ID` | `--channel-id` | チャンネル ID | (必須) |
| `channel_secret` | `LINE_CHANNEL_SECRET` | `--channel-secret` | チャンネルシークレット | (必須) |
| `access_token` | `LINE_ACCESS_TOKEN` | `--access-token` | 発行済みトークン | (任意) |

### 優先順位

環境変数 → 設定ファイル (オーバーライド) → CLI フラグ (最終オーバーライド)

### 設定ファイル

`.line-cli.yaml` (カレントディレクトリまたは `$HOME`)

```yaml
base_url: http://my-conoha-server:3000
channel_id: "1234567890"
channel_secret: "abcdef1234567890abcdef1234567890"
access_token: "Bearer ..."
```

`--config` フラグで任意のパスも指定可能。

## コマンド詳細

### token グループ

```bash
line-cli-go token issue
# → POST /v2/oauth/accessToken
# → 出力: access_token, expires_in, token_type

line-cli-go token issue-v3
# → POST /oauth2/v2.1/token
# → 出力: access_token, expires_in, token_type, key_id

line-cli-go token verify --access-token TOKEN
# → POST /v2/oauth/verify
# → 出力: scope, client_id, expires_in

line-cli-go token revoke --access-token TOKEN
# → POST /v2/oauth/revoke

line-cli-go token list-kids
# → GET /oauth2/v2.1/tokens/kid
# → 出力: key ID 一覧
```

### message グループ

```bash
line-cli-go message push --to USER_ID --text "hello"
# → POST /v2/bot/message/push

line-cli-go message reply --reply-token TOKEN --text "hi"
# → POST /v2/bot/message/reply

line-cli-go message multicast --to USER1,USER2 --text "hello"
# → POST /v2/bot/message/multicast

line-cli-go message broadcast --text "hello everyone"
# → POST /v2/bot/message/broadcast

line-cli-go message narrowcast --text "targeted"
# → POST /v2/bot/message/narrowcast
# → 202 を返し、request_id を出力
```

メッセージは `--text` でテキストメッセージを送信するのが基本。`--payload-file message.json` フラグで画像/動画等の複合メッセージ JSON を直接指定も可能。

### profile グループ

```bash
line-cli-go profile get --user-id USER_ID
# → GET /v2/bot/profile/:userId
# → 出力: displayName, userId, pictureUrl, language
```

### webhook グループ

```bash
line-cli-go webhook get
# → GET /v2/bot/channel/webhook/endpoint
# → 出力: endpoint, active

line-cli-go webhook set --url https://example.com/callback
# → PUT /v2/bot/channel/webhook/endpoint

line-cli-go webhook test [--url https://...]
# → POST /v2/bot/channel/webhook/test
# → 出力: success, timestamp, statusCode
```

### content グループ

```bash
line-cli-go content get --message-id MSG_ID [--output file.png]
# → GET /v2/bot/message/:messageId/content
# → --output なし: stdout にバイナリ出力
# → --output あり: ファイル保存
```

### quota グループ

```bash
line-cli-go quota get
# → GET /v2/bot/message/quota
# → 出力: type, value

line-cli-go quota consumption
# → GET /v2/bot/message/quota/consumption
# → 出力: totalUsage
```

## 出力形式

### テキストモード (デフォルト)

```
✓ Message pushed successfully
  Message ID: 1234567890
  To: U1234567890abcdef
```

### JSON モード (`--json`)

```json
{"messageId":"1234567890","to":"U1234567890abcdef"}
```

### エラー出力

```
テキスト:
✗ Push failed (400 Bad Request)
  Invalid reply token

JSON:
{"error":true,"status":400,"message":"Invalid reply token"}
```

### 接続不可時

```
✗ Cannot connect to http://localhost:3000
  Is the mock server running? Try: docker compose up
```

### 終了コード

- 0: 成功
- 1: API エラー
- 2: 設定不備等のクライアントエラー

## SDK 統合

### クライアント生成

`line-bot-sdk-go` v8 は OpenAPI ベースの自動生成で、ドメインごとにパッケージが分かれている:

- **`messaging_api.MessagingApiAPI`** — push, reply, multicast, broadcast, profile, content
- **OAuth 関連** — SDK の OAuth クライアントまたは直接 HTTP 呼び出し (SDK の OAuth サポート範囲に依存)

`BaseURL` を mock サーバーにオーバーライドして接続する。

## テスト

### 単体テスト (`*_test.go`)

- `internal/config` — 設定優先順位ロジック (env < file < flag)
- `internal/output` — テキスト/JSON フォーマッター

### 統合テスト (`test/integration/`)

- line-api-mock を docker compose で起動した状態で CLI コマンドを実行
- トークン発行 → メッセージ push → プロフィール取得等のシナリオテスト
- `os/exec` でビルド済みバイナリを直接実行し CLI 出力を検証
- `--json` 出力をパースして assertions

## ドキュメント

### README.md

- クイックスタート (mock 起動 → ビルド → 設定 → 実行)
- コマンド一覧テーブル
- 設定方法 (優先順位、設定ファイル例)
- ConoHa 上の mock サーバーに接続する場合の設定例

### .env.example

```
LINE_BASE_URL=http://localhost:3000
LINE_CHANNEL_ID=1234567890
LINE_CHANNEL_SECRET=abcdef1234567890abcdef1234567890
LINE_ACCESS_TOKEN=
```

## スコープ外

- トークン自動保存 (発行後の永続化はしない、サンプルの単純性を維持)
- REPL / インタラクティブモード
- 未実装エンドポイント (LIFF, Insight, Audience 等) — Rich Menu は別 spec (`2026-04-21-line-cli-go-richmenu-design.md`) で PR-1 (core + linking) 実装済み / PR-2 (alias + batch) 予定
- CLI 自体のサーバー配備 (クライアントツールのため不要)
