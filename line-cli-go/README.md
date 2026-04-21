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
| `richmenu create` | リッチメニュー作成 (`--payload-file`) |
| `richmenu validate` | リッチメニュー JSON 検証 (dry-run) |
| `richmenu list` | リッチメニュー一覧 |
| `richmenu get` | リッチメニュー取得 |
| `richmenu delete` | リッチメニュー削除 |
| `richmenu set-image` | 画像アップロード (`--image` / stdin 可) |
| `richmenu get-image` | 画像ダウンロード (`--output` / stdout 可) |
| `richmenu set-default` | 既定リッチメニュー設定 |
| `richmenu get-default` | 既定リッチメニュー ID 取得 |
| `richmenu cancel-default` | 既定リッチメニュー解除 |
| `richmenu link` | ユーザーにリンク |
| `richmenu unlink` | ユーザーのリンク解除 |
| `richmenu get-for-user` | ユーザーのリンク先取得 |
| `richmenu bulk-link` | 複数ユーザーへの一括リンク |
| `richmenu bulk-unlink` | 複数ユーザーの一括リンク解除 |

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

## リッチメニュー使用例

### 作成 / 取得

```bash
# JSON からリッチメニュー作成
./line-cli-go richmenu create --payload-file rm.json

# 検証のみ (作成しない)
./line-cli-go richmenu validate --payload-file rm.json

# 一覧
./line-cli-go --json richmenu list

# 1 件取得
./line-cli-go richmenu get --rich-menu-id RM123
```

### 画像

```bash
# PNG アップロード (拡張子で Content-Type 判定)
./line-cli-go richmenu set-image --rich-menu-id RM123 --image menu.png

# stdin からアップロード
curl -s https://example.com/menu.png | \
  ./line-cli-go richmenu set-image --rich-menu-id RM123 --image -

# ファイル保存
./line-cli-go richmenu get-image --rich-menu-id RM123 --output out.png

# stdout へ (リダイレクト可)
./line-cli-go richmenu get-image --rich-menu-id RM123 > out.png
```

### 既定リッチメニュー

```bash
./line-cli-go richmenu set-default --rich-menu-id RM123
./line-cli-go --json richmenu get-default
./line-cli-go richmenu cancel-default
```

### ユーザーリンク

```bash
# 単体
./line-cli-go richmenu link --user-id U123 --rich-menu-id RM123
./line-cli-go --json richmenu get-for-user --user-id U123
./line-cli-go richmenu unlink --user-id U123

# 一括 (1 呼び出しあたり 1-500 ユーザー)
./line-cli-go richmenu bulk-link --rich-menu-id RM123 --user-ids U1,U2,U3
./line-cli-go richmenu bulk-unlink --user-ids U1,U2,U3

# payload-file で直接指定
./line-cli-go richmenu bulk-link --payload-file bulk.json
```

### 最小エンドツーエンドフロー

```bash
# 1. 作成
ID=$(./line-cli-go --json richmenu create --payload-file rm.json | jq -r .richMenuId)

# 2. 画像アップロード
./line-cli-go richmenu set-image --rich-menu-id "$ID" --image menu.png

# 3. 既定にセット
./line-cli-go richmenu set-default --rich-menu-id "$ID"
```

## 統合テスト

リッチメニューまわりは `TEST_ACCESS_TOKEN` と `TEST_USER_ID` が設定されているときのみ実行:

```bash
export LINE_BASE_URL=http://localhost:3000
export TEST_ACCESS_TOKEN=<mock トークン>
export TEST_USER_ID=U1234567890abcdef1234567890abcdef
go test ./test/integration/... -v -run RichMenu
```

env var がない場合はスキップされる。
