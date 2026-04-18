# line-cli-go

LINE Messaging API CLI client (Go) — [line-api-mock](../line-api-mock) 連動サンプル

LINE 公式 Go SDK ([line-bot-sdk-go](https://github.com/line/line-bot-sdk-go) v8) を使用して、
line-api-mock が実装する全エンドポイントを操作する CLI ツール。

## クイックスタート

### 1. line-api-mock を起動

```bash
cd ../line-api-mock
docker compose up -d
```

起動ログに表示されるチャンネル ID・シークレットを控えてください。

### 2. ビルド

```bash
cd ../line-cli-go
go build -o line-cli-go .
```

### 3. 設定

```bash
cp .env.example .env
# .env を編集してチャンネル ID・シークレットを設定
```

または設定ファイルを使用:

```bash
cp .line-cli.yaml.example .line-cli.yaml
# .line-cli.yaml を編集
```

### 4. トークン発行

```bash
./line-cli-go token issue
```

### 5. メッセージ送信

```bash
./line-cli-go message push --to <USER_ID> --text "Hello from Go CLI!"
```

## コマンド一覧

| コマンド | 説明 |
|---------|------|
| `token issue` | v2 チャンネルアクセストークン発行 |
| `token issue-v21` | v2.1 JWT ベーストークン発行 |
| `token verify` | トークン検証 |
| `token revoke` | トークン失効 |
| `token list-kids` | v2.1 有効キー ID 一覧 |
| `message push` | プッシュメッセージ送信 |
| `message reply` | リプライメッセージ送信 |
| `message multicast` | マルチキャスト送信 |
| `message broadcast` | ブロードキャスト送信 |
| `message narrowcast` | ナローキャスト送信 (非同期) |
| `profile get` | ユーザープロフィール取得 |
| `webhook get` | Webhook エンドポイント取得 |
| `webhook set` | Webhook エンドポイント設定 |
| `webhook test` | Webhook 接続テスト |
| `content get` | メッセージコンテンツ取得 |
| `quota get` | メッセージクォータ取得 |
| `quota consumption` | クォータ消費量取得 |

## 設定

設定の優先順位: 環境変数 → 設定ファイル → CLI フラグ

| 環境変数 | CLI フラグ | 説明 | デフォルト |
|---------|-----------|------|-----------|
| `LINE_BASE_URL` | `--base-url` | mock サーバー URL | `http://localhost:3000` |
| `LINE_CHANNEL_ID` | `--channel-id` | チャンネル ID | (必須) |
| `LINE_CHANNEL_SECRET` | `--channel-secret` | チャンネルシークレット | (必須) |
| `LINE_ACCESS_TOKEN` | `--access-token` | アクセストークン | (任意) |

### JSON 出力

全コマンドで `--json` フラグを付けると JSON 形式で出力:

```bash
./line-cli-go --json token issue
./line-cli-go --json message push --to U123 --text "hello"
```

### ConoHa 上の mock サーバーに接続

```yaml
# .line-cli.yaml
base_url: http://<conoha-server-ip>:3000
channel_id: "1234567890"
channel_secret: "abcdef..."
```

## 技術スタック

- Go 1.24+
- [line-bot-sdk-go](https://github.com/line/line-bot-sdk-go) v8
- [cobra](https://github.com/spf13/cobra) — CLI フレームワーク
- [viper](https://github.com/spf13/viper) — 設定管理
