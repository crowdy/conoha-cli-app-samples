---
title: LINE公式Go SDKでモックサーバーを叩いてみたら、SDKとの互換性の穴が2つ見つかった話
tags: LINE Go SDK テスト Mock
author: crowdy
slide: false
---
## はじめに

前回の記事で、[LINE Messaging API のモックサーバー (line-api-mock)](https://qiita.com/crowdy/items/xxx) を作って ConoHa VPS にデプロイしました。Node.js の公式 SDK (`@line/bot-sdk`) では `baseURL` を差し替えるだけで動作することを確認済みです。

では **Go の公式 SDK (`line-bot-sdk-go` v8)** ではどうだろう？——これが今回の出発点です。

LINE Bot を Go で書く人は多いですし、SDK が OpenAPI ベースで自動生成されている以上、言語ごとにリクエストの形が微妙に異なる可能性があります。Node.js SDK で通ったからといって Go SDK でも通るとは限りません。

そこで、Go SDK を使って mock の全エンドポイントを叩く CLI クライアント **`line-cli-go`** を作り、実際に ConoHa 上のモックサーバーに対してテストしました。結果として **17 コマンド中 15 が正常動作し、2 つで SDK との互換性の穴** を発見しました。この記事では、CLI の構成、実行結果、そして発見した問題とその原因を共有します。

---

## 作ったもの

`line-cli-go` は、LINE Messaging API の全エンドポイントをターミナルから操作できる Go 製 CLI ツールです。

| コンポーネント | 役割 |
|---|---|
| **Go** 1.24 | 言語 |
| **line-bot-sdk-go** v8.20.0 | LINE 公式 Go SDK |
| **cobra** | CLI フレームワーク (kubectl, docker, gh と同じ) |
| **viper** | 設定管理 (env < config file < CLI flag) |

### コマンド一覧

```
line-cli-go
  token issue          # v2 トークン発行
  token issue-v3       # v2.1 JWT トークン発行
  token verify         # トークン検証
  token revoke         # トークン失効
  token list-kids      # v2.1 key ID 一覧
  message push         # プッシュ送信
  message reply        # リプライ送信
  message multicast    # マルチキャスト
  message broadcast    # ブロードキャスト
  message narrowcast   # ナローキャスト
  profile get          # プロフィール取得
  webhook get          # webhook 取得
  webhook set          # webhook 設定
  webhook test         # webhook テスト
  content get          # コンテンツ取得
  quota get            # クォータ確認
  quota consumption    # 消費量確認
```

---

## 設計のポイント

### 1. SDK の `baseURL` を差し替えるだけ

Go SDK v8 は OpenAPI から自動生成されたクライアントで、`WithEndpoint()` オプションでベース URL を変更できます。

```go
// internal/client/client.go
func NewMessagingAPI() (*messaging_api.MessagingApiAPI, error) {
    client, err := messaging_api.NewMessagingApiAPI(
        config.AccessToken(),
        messaging_api.WithEndpoint(config.BaseURL()),   // ← モックを指定
        messaging_api.WithHTTPClient(httpClient()),
    )
    return client, err
}
```

OAuth トークン用のクライアントも同様です。

```go
func NewChannelAccessTokenAPI() (*channel_access_token.ChannelAccessTokenAPI, error) {
    client, err := channel_access_token.NewChannelAccessTokenAPI(
        channel_access_token.WithEndpoint(config.BaseURL()),
    )
    return client, err
}
```

### 2. 設定の 3 段階オーバーライド

viper を使い、**環境変数 < 設定ファイル (`.line-cli.yaml`) < CLI フラグ** の優先順位で設定を解決します。

```yaml
# .line-cli.yaml
base_url: http://160.251.184.240:3000
channel_id: "9875215823"
channel_secret: "3f2077426350d19ff96946b939df5568"
```

```bash
# CLI フラグが最優先
./line-cli-go --access-token $TOKEN quota get
```

### 3. テキスト / JSON 出力の切り替え

`--json` フラグで出力形式を切り替えられます。

```bash
# テキストモード (デフォルト)
$ ./line-cli-go quota get
  type: limited
  value: 1000

# JSON モード
$ ./line-cli-go --json quota get
{
  "type": "limited",
  "value": 1000
}
```

エラーは stderr に出力し、終了コードで API エラー (1) と設定エラー (2) を区別します。

### 4. null フィールドの除去

Go SDK は OpenAPI の全フィールドを Go 構造体に持っているため、未設定のオプショナルフィールドが JSON で `null` としてシリアライズされます。line-api-mock の AJV バリデータは `"must be array"` と怒ります。

カスタム HTTP Transport で JSON リクエストから `null` フィールドを自動除去して解決しました。

```go
type nullStripTransport struct {
    base http.RoundTripper
}

func (t *nullStripTransport) RoundTrip(req *http.Request) (*http.Response, error) {
    if req.Body != nil && strings.Contains(req.Header.Get("Content-Type"), "application/json") {
        body, _ := io.ReadAll(req.Body)
        req.Body.Close()
        var data map[string]any
        if json.Unmarshal(body, &data) == nil {
            stripNulls(data)
            cleaned, _ := json.Marshal(data)
            req.Body = io.NopCloser(bytes.NewReader(cleaned))
            req.ContentLength = int64(len(cleaned))
        }
    }
    return t.base.RoundTrip(req)
}
```

これは Go SDK 固有の問題です。Node.js の `@line/bot-sdk` は `undefined` のフィールドを JSON にそもそも含めないので起きません。

---

## ConoHa 上のモックサーバーに対する実行結果

前回の記事でデプロイした `160.251.184.240:3000` のモックに対して、全 17 コマンドを実行しました。

### トークン発行・検証・失効

```bash
$ ./line-cli-go token issue
  access_token: 4dbd060de0ccb4c4bee61592170e8e205f3ad12ad3e797ea
  expires_in: 2592000
  token_type: Bearer

$ ./line-cli-go --access-token $TOKEN token verify
  client_id: 9875215823
  expires_in: 2591991
  scope:

$ ./line-cli-go --access-token $TOKEN token revoke
✓ Token revoked
```

v2 OAuth のフロー (issue → verify → revoke) は完全に動作しました。

### メッセージ送信

```bash
$ ./line-cli-go message push --to Ufb864fd820f62456f3559977bacd77b4 --text "hello from Go CLI"
  sentMessages: [457285719429999121]

$ ./line-cli-go message broadcast --text "broadcast test"
✓ Broadcast sent

$ ./line-cli-go message multicast --to Ufb864fd820f62456f3559977bacd77b4 --text "multicast test"
✓ Multicast sent
  recipients: 1

$ ./line-cli-go message narrowcast --text "narrowcast test"
✓ Narrowcast accepted (202)
```

push / broadcast / multicast / narrowcast すべて成功。管理 UI の会話画面にもメッセージが即座に反映されました。

### プロフィール・Webhook・クォータ

```bash
$ ./line-cli-go profile get --user-id Ufb864fd820f62456f3559977bacd77b4
  displayName: テストユーザー
  language: ja
  userId: Ufb864fd820f62456f3559977bacd77b4

$ ./line-cli-go webhook get
  active: true
  endpoint: 

$ ./line-cli-go webhook set --url https://example.com/hook
✓ Webhook endpoint updated
  endpoint: https://example.com/hook

$ ./line-cli-go quota get
  type: limited
  value: 1000

$ ./line-cli-go quota consumption
  totalUsage: 2
```

### エラーハンドリング

```bash
# 設定不足 → exit code 2
$ ./line-cli-go token issue
$ echo $?
2

# 不正トークン → exit code 1, HTTP ステータス付き
$ ./line-cli-go --access-token INVALID_TOKEN profile get --user-id Ufake
✗ Failed (401)
  unexpected status code: 401, {"message":"Authentication failed due to the expired access token"}
$ echo $?
1
```

---

## 発見した互換性の穴: v2.1 OAuth

### 症状

```bash
$ ./line-cli-go token issue-v3
✗ Failed (400)
  unexpected status code: 400, {"message":"client_id and client_assertion required"}
```

`token issue-v3` (JWT ベース) と `token list-kids` の 2 コマンドが失敗しました。

### 原因

line-api-mock の `/oauth2/v2.1/token` は `client_id` を **form フィールド**として要求しています。

```typescript
// line-api-mock/src/mock/oauth-v3.ts
const clientId = String(form.client_id ?? "");
const assertion = String(form.client_assertion ?? "");
if (!clientId || !assertion) {
  return errors.badRequest(c, "client_id and client_assertion required");
}
```

しかし Go SDK の `IssueChannelTokenByJWT()` は以下の 3 フィールドしか form に含めません。

```
grant_type=client_credentials
client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
client_assertion=<JWT>
```

**`client_id` が form に入っていない。** 実際の LINE API では `client_id` は JWT の `iss` claim に含まれ、サーバー側が JWT をデコードして取得します。mock は JWT を検証しないため、`client_id` を form フィールドとして別途要求していたのですが、Go SDK はそれを送りません。

Node.js SDK では `client_id` を form に含めるため、この問題は起きていませんでした。

### 結果の整理

| コマンド | 結果 | 備考 |
|---|---|---|
| token issue | ✅ | v2 OAuth |
| token verify | ✅ | |
| token revoke | ✅ | |
| token issue-v3 | ❌ | mock が `client_id` を form で要求 |
| token list-kids | ❌ | 同上 |
| message push | ✅ | null strip transport で対応 |
| message reply | ✅ | |
| message multicast | ✅ | |
| message broadcast | ✅ | |
| message narrowcast | ✅ | |
| profile get | ✅ | |
| webhook get | ✅ | |
| webhook set | ✅ | |
| webhook test | ✅ | |
| content get | ✅ | |
| quota get | ✅ | |
| quota consumption | ✅ | |

**17 コマンド中 15 成功、2 失敗。** 失敗はすべて v2.1 OAuth エンドポイント。

---

## mock 側の修正方針

この問題は [GitHub Issue #23](https://github.com/crowdy/conoha-cli-app-samples/issues/23) として登録しました。

mock 側で `client_id` を以下の優先順で取得するよう修正する予定です。

1. **form フィールド `client_id`** (既存動作、Node.js SDK 互換)
2. **JWT の `iss` claim をデコード** (署名検証なし、payload のみ) して `client_id` として使用 (Go SDK 互換)

これにより、Node.js SDK と Go SDK の**両方**が修正なしで動作するようになります。

---

## 学んだこと

### 1. 「Node.js SDK で通った」は「Go SDK でも通る」を意味しない

OpenAPI から自動生成される SDK は、**言語ごとにリクエストの形が異なる**ことがあります。

| SDK | `null` フィールド | v2.1 OAuth の `client_id` |
|---|---|---|
| Node.js (`@line/bot-sdk`) | `undefined` → JSON に含まれない | form に含める |
| Go (`line-bot-sdk-go` v8) | `nil` → `null` で含まれる | form に含めない |

モックを作るなら、**対象となるすべての公式 SDK で互換性テストを書く**のが理想です。今回はまさにそれを実践して、Node.js SDK では見えなかった問題を 2 つ発見できました。

### 2. Go SDK の null フィールドは HTTP Transport で吸収できる

Go の構造体は「フィールドが存在しない」ことを表現できません (`nil` と `未設定` の区別がない)。SDK が `omitempty` タグを付けていない限り、optional フィールドは `null` としてシリアライズされます。

strict な OpenAPI バリデータと組み合わせると問題が顕在化しますが、**カスタム HTTP Transport で JSON body から null を除去する** というパターンで汎用的に対処できます。

### 3. exit code を分けておくとスクリプト連携が楽

```bash
./line-cli-go token issue
case $? in
  0) echo "ok" ;;
  1) echo "API error" ;;
  2) echo "config missing" ;;
esac
```

成功 (0) / API エラー (1) / 設定エラー (2) の 3 段階を分けておくと、CI やシェルスクリプトから使うときに便利です。

---

## まとめ

| 項目 | 内容 |
|---|---|
| 作ったもの | LINE Messaging API CLI クライアント (Go) |
| SDK | line-bot-sdk-go v8.20.0 |
| 対象 | line-api-mock (前回デプロイ済み) |
| テスト結果 | 17 コマンド中 15 成功、2 失敗 |
| 発見した問題 | v2.1 OAuth の `client_id` form フィールド非互換 |
| null strip | カスタム HTTP Transport で解決 |
| サンプル | [crowdy/conoha-cli-app-samples/line-cli-go](https://github.com/crowdy/conoha-cli-app-samples/tree/feat/line-cli-go/line-cli-go) |
| Issue | [#23](https://github.com/crowdy/conoha-cli-app-samples/issues/23) |

モックサーバーを作ったら、**複数の公式 SDK で叩いてみる**のが最善の互換性テストです。Node.js SDK で全テストが通っていても、Go SDK で叩くと異なるリクエスト形式による非互換が見つかりました。

今後は Python SDK (`line-bot-sdk-python`) でも同様のテストを行い、mock の互換性をさらに向上させる予定です。

---

## 参考

- サンプルコード: [crowdy/conoha-cli-app-samples/line-cli-go](https://github.com/crowdy/conoha-cli-app-samples/tree/feat/line-cli-go/line-cli-go)
- line-api-mock: [crowdy/conoha-cli-app-samples/line-api-mock](https://github.com/crowdy/conoha-cli-app-samples/tree/main/line-api-mock)
- [line/line-bot-sdk-go](https://github.com/line/line-bot-sdk-go) — LINE 公式 Go SDK
- [line/line-openapi](https://github.com/line/line-openapi) — LINE 公式 OpenAPI 仕様
- [LINE Developers — Messaging API リファレンス](https://developers.line.biz/ja/reference/messaging-api/)
- [spf13/cobra](https://github.com/spf13/cobra) — Go CLI フレームワーク
- [spf13/viper](https://github.com/spf13/viper) — Go 設定管理
