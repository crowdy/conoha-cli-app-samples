# line-cli-go: Rich Menu サポート追加 設計

## 背景

同リポジトリの `line-api-mock` に LINE Messaging API の Rich Menu 全 23 endpoints が PR #26 (core + linking, 15) と PR #33 (alias + batch, 8) で実装済み。`line-cli-go` (Go / cobra CLI) は既存グループ (`token` / `message` / `profile` / `webhook` / `content` / `quota`) 経由で mock をテストできるが、Rich Menu 関連コマンドが未実装。本 spec は line-cli-go に対応する 23 コマンドを追加する設計を定義する。

**関連 spec:**
- `docs/superpowers/specs/2026-04-18-line-cli-go-design.md` — line-cli-go 本体設計 (現在 Rich Menu は「スコープ外」)
- `docs/superpowers/specs/2026-04-21-line-api-mock-richmenu-design.md` — mock 側 PR #26
- `docs/superpowers/specs/2026-04-21-line-api-mock-richmenu-alias-batch-design.md` — mock 側 PR #33

## 設計判断サマリー

| 項目 | 決定 | 理由 |
|---|---|---|
| 分割戦略 | 2 PR: PR-1 = core+linking (15) / PR-2 = alias+batch (8) | mock 側と同一ペース。PR-1 安定後の feedback を PR-2 に反映可能。各 PR の diff サイズが管理可能 |
| subcommand 階層 | 3 階層 (`richmenu alias create`, `richmenu batch submit`) | LINE API 公式ドキュメントが alias / batch を別リソースとして扱う。cobra の nested subcommand は標準パターン |
| JSON 入力方式 | `--payload-file` ファイル経由 (既存 `message push` と同一) | SDK 構造体への `json.Unmarshal` 1 回で済む。個別 flag 定義による重複回避 |
| 画像入出力 | upload は `--image path` (or `-` for stdin)、download は `--output path` or stdout | 既存 `content get` と一貫。パイプ利用も可能 |
| テスト方針 | unit tests (CI) + integration tests (env var 必要、ローカル手動) | 既存 line-cli-go の方針を踏襲 |
| polling | 実装しない (`batch progress` は 1 回呼び出し) | YAGNI。shell loop で代替可能 |

## 対象エンドポイント (23)

### PR-1: core + image + default + linking (15)

| # | CLI | HTTP | SDK method (v8) |
|---|---|---|---|
| 1 | `richmenu create --payload-file rm.json` | POST `/v2/bot/richmenu` | `MessagingApiAPI.CreateRichMenu` |
| 2 | `richmenu validate --payload-file rm.json` | POST `/v2/bot/richmenu/validate` | `ValidateRichMenuObject` |
| 3 | `richmenu list` | GET `/v2/bot/richmenu/list` | `GetRichMenuList` |
| 4 | `richmenu get --rich-menu-id RM` | GET `/v2/bot/richmenu/:richMenuId` | `GetRichMenu` |
| 5 | `richmenu delete --rich-menu-id RM` | DELETE `/v2/bot/richmenu/:richMenuId` | `DeleteRichMenu` |
| 6 | `richmenu set-image --rich-menu-id RM --image f.png` | POST `/v2/bot/richmenu/:richMenuId/content` | `MessagingApiBlobAPI.SetRichMenuImage` |
| 7 | `richmenu get-image --rich-menu-id RM [--output f.png]` | GET `/v2/bot/richmenu/:richMenuId/content` | `MessagingApiBlobAPI.GetRichMenuImage` |
| 8 | `richmenu set-default --rich-menu-id RM` | POST `/v2/bot/user/all/richmenu/:richMenuId` | `SetDefaultRichMenu` |
| 9 | `richmenu get-default` | GET `/v2/bot/user/all/richmenu` | `GetDefaultRichMenuId` |
| 10 | `richmenu cancel-default` | DELETE `/v2/bot/user/all/richmenu` | `CancelDefaultRichMenu` |
| 11 | `richmenu link --user-id U --rich-menu-id RM` | POST `/v2/bot/user/:userId/richmenu/:richMenuId` | `LinkRichMenuIdToUser` |
| 12 | `richmenu unlink --user-id U` | DELETE `/v2/bot/user/:userId/richmenu` | `UnlinkRichMenuIdFromUser` |
| 13 | `richmenu get-for-user --user-id U` | GET `/v2/bot/user/:userId/richmenu` | `GetRichMenuIdOfUser` |
| 14 | `richmenu bulk-link --rich-menu-id RM --user-ids U1,U2` | POST `/v2/bot/richmenu/bulk/link` | `LinkRichMenuIdToUsers` |
| 15 | `richmenu bulk-unlink --user-ids U1,U2` | POST `/v2/bot/richmenu/bulk/unlink` | `UnlinkRichMenuIdFromUsers` |

### PR-2: alias + batch (8)

| # | CLI | HTTP | SDK method |
|---|---|---|---|
| 16 | `richmenu alias create --alias-id A --rich-menu-id RM` | POST `/v2/bot/richmenu/alias` | `CreateRichMenuAlias` |
| 17 | `richmenu alias list` | GET `/v2/bot/richmenu/alias/list` | `GetRichMenuAliasList` |
| 18 | `richmenu alias get --alias-id A` | GET `/v2/bot/richmenu/alias/:aliasId` | `GetRichMenuAlias` |
| 19 | `richmenu alias update --alias-id A --rich-menu-id RM` | POST `/v2/bot/richmenu/alias/:aliasId` | `UpdateRichMenuAlias` |
| 20 | `richmenu alias delete --alias-id A` | DELETE `/v2/bot/richmenu/alias/:aliasId` | `DeleteRichMenuAlias` |
| 21 | `richmenu batch validate --payload-file ops.json` | POST `/v2/bot/richmenu/validate/batch` | `ValidateRichMenuBatchRequest` |
| 22 | `richmenu batch submit --payload-file ops.json` | POST `/v2/bot/richmenu/batch` | `RichMenuBatch` |
| 23 | `richmenu batch progress --request-id REQ` | GET `/v2/bot/richmenu/progress/batch` | `GetRichMenuBatchProgress` |

## ファイル構造

```
line-cli-go/
├── cmd/
│   └── richmenu/
│       ├── richmenu.go          # RichMenuCmd (cobra group) + init で下位コマンド登録
│       ├── create.go            # richmenu create
│       ├── validate.go          # richmenu validate (dry-run)
│       ├── list.go              # richmenu list
│       ├── get.go               # richmenu get
│       ├── delete.go            # richmenu delete
│       ├── set_image.go         # richmenu set-image
│       ├── get_image.go         # richmenu get-image
│       ├── set_default.go       # richmenu set-default
│       ├── get_default.go       # richmenu get-default
│       ├── cancel_default.go    # richmenu cancel-default
│       ├── link.go              # richmenu link
│       ├── unlink.go            # richmenu unlink
│       ├── get_for_user.go      # richmenu get-for-user
│       ├── bulk_link.go         # richmenu bulk-link
│       ├── bulk_unlink.go       # richmenu bulk-unlink
│       ├── alias/               # PR-2
│       │   ├── alias.go         # AliasCmd (group)
│       │   ├── create.go
│       │   ├── list.go
│       │   ├── get.go
│       │   ├── update.go
│       │   └── delete.go
│       └── batch/               # PR-2
│           ├── batch.go         # BatchCmd (group)
│           ├── submit.go
│           ├── progress.go
│           └── validate.go
├── internal/
│   └── payload/                 # 新規共通ヘルパー
│       ├── payload.go           # LoadJSON / LoadImage
│       └── payload_test.go
└── test/
    └── integration/
        ├── richmenu_test.go           # PR-1
        ├── richmenu_alias_test.go     # PR-2
        ├── richmenu_batch_test.go     # PR-2
        └── testdata/
            ├── rm.json           # RichMenuRequest template
            ├── rm.png            # 2500x1686 テスト画像
            ├── bulk.json         # bulk-link/unlink payload template
            └── batch_ops.json    # batch operations template
```

`cmd/root.go` に `rootCmd.AddCommand(richmenu.RichMenuCmd)` を 1 行追加。

## SDK 統合 / データフロー

### クライアント生成

既存 `internal/client/client.go` の以下を流用 (新規ファクトリ追加なし):
- `NewMessagingAPI()` — 15/23 endpoints (JSON)
- `NewMessagingBlobAPI()` — 2/23 endpoints (set-image / get-image)

既存 `nullStripTransport` が SDK の `null` 値フィールドを削除するため、line-api-mock の AJV strict 検証と互換。message 実装で検証済み。

### 共通データフロー

**write 系 (create / update / validate / batch / bulk):**
1. `--payload-file` を `payload.LoadJSON` で読込 → SDK 構造体へ `json.Unmarshal`
2. flag override 適用 (bulk-link の `--user-ids` など)
3. `api.<Method>(&req)`
4. `p.Raw(resp)` または `p.Success(...)` で出力

**read 系 (get / list / get-default / progress):**
1. flag パース
2. `api.<Method>(params...)`
3. `p.Raw(resp)`

**blob 系 (set-image):**
1. `payload.LoadImage(path)` → `(io.ReadCloser, contentType, error)` / `path == "-"` で stdin
2. content-type: 拡張子優先 (`.png`, `.jpg`, `.jpeg`)、拡張子なしは `http.DetectContentType`
3. `api.SetRichMenuImage(richMenuId, contentType, reader)`

**blob 系 (get-image):**
1. `api.GetRichMenuImage(richMenuId)` → `*http.Response`
2. `defer resp.Body.Close()`
3. `--output` あればファイル保存、なければ `io.Copy(os.Stdout, resp.Body)` (既存 `content get` と同一)

### 新規共通パッケージ `internal/payload/`

```go
// LoadJSON reads path into v via json.Unmarshal.
// path == "-" reads from os.Stdin.
// file-not-found / invalid-json は config.ClientError (exit 2) を返す。
func LoadJSON(path string, v any) error

// LoadImage opens path as image, returns (reader, contentType).
// path == "-" reads from stdin (content-type is http.DetectContentType sniffed).
// 拡張子から content-type 決定: .png / .jpg / .jpeg / その他は http.DetectContentType。
func LoadImage(path string) (io.ReadCloser, string, error)
```

**抽出理由:** payload 読込は PR-1 で 4 コマンド (create / validate / bulk-link / bulk-unlink)、PR-2 で 4 コマンド (alias create / update / batch submit / batch validate) = 計 8 コマンドで重複。既存 `message/push.go` が直接 `os.ReadFile` + `json.Unmarshal` しているのは独立実装で、今回の共通化を機に将来 message 側もこのヘルパーに寄せられる (本 PR のスコープ外)。

### 出力フォーマット

既存 `internal/output.Printer` をそのまま使用:
- `p.Raw(resp)` — JSON モード: SDK 構造体を直接シリアライズ / text モード: key-value 列挙
- `p.Success(msg, fields)` — side-effect 系 (delete, link, unlink, set-default, cancel-default, set-image, bulk-*, alias delete)
- `p.Error(status, msg)` — エラー時

### `batch submit` の 202 + request id ヘッダ処理

`batch submit` は 202 Accepted + `x-line-request-id` ヘッダで非同期 request id を返す。SDK は 2xx をエラー扱いしないが body は空。`WithHttpInfo` variant (`RichMenuBatchWithHttpInfo`) を使用し `*http.Response` からヘッダ抽出:

```go
_, httpResp, err := api.RichMenuBatchWithHttpInfo(&req)
requestID := httpResp.Header.Get("x-line-request-id")
p.Raw(map[string]any{"requestId": requestID})
```

### bulk-link / bulk-unlink の二重入力

両方許容 (既存 `message push` の `--text` / `--payload-file` パターンと一貫):
- `--user-ids U1,U2,U3` (カンマ区切り、最大 500)
- `--payload-file bulk.json` (完全な request 構造)

両方指定時は `--payload-file` をベースに `--user-ids` で `userIds` フィールドを override。`bulk-link` では `--rich-menu-id` も同様に override。

### グローバル flag

`--base-url` / `--access-token` / `--channel-id` / `--channel-secret` / `--json` は `root.go` の PersistentFlag を継承 (既存と同じ)。richmenu グループ専用の共通 flag なし。

## エラー処理 / 終了コード

### 終了コード (既存踏襲)

| コード | 意味 |
|---|---|
| 0 | 成功 |
| 1 | API エラー (非 2xx) |
| 2 | クライアントエラー (設定 / flag / ファイル) |

`cmd/root.go` の `errors.As(err, &config.ClientError)` 分岐で自動振り分け。

### エラー分類

| 分類 | 例 | 処理 |
|---|---|---|
| flag 未指定 | `--rich-menu-id` なし | `&config.ClientError{Msg: "--rich-menu-id is required"}` → exit 2 |
| ファイル I/O | `--payload-file` 不在 / invalid JSON | `payload.LoadJSON` が `ClientError` で包んで返す → exit 2 |
| SDK エラー | HTTP 非 2xx | `p.Error(ExtractHTTPStatus(err), err.Error())` → exit 1 |
| 接続失敗 | mock 未起動 | `p.Error(0, err.Error())` → exit 1 (既存踏襲、追加ヒントなし) |

### 特殊ステータス

- **202 (`batch submit`)** — 成功扱い、request id 抽出
- **404** (get / delete / alias get/delete/update / get-for-user / get-default / batch progress) — 通常 API エラー
- **409** (`alias create`) — alias 既存。通常 API エラー
- **400** (validate / bulk / batch / set-image) — body に詳細。stderr 出力 (`p.Error`)

### polling / 部分失敗

- `batch progress` は単発呼び出し。`--watch` / 再試行 loop は **実装しない** (YAGNI)
- `bulk-link/unlink` は all-or-nothing (line-api-mock 実装)。部分成功処理なし
- `batch submit` の個別 operation 結果は `batch progress` のみで取得可

## テスト戦略

### Unit tests (CI で実行)

**`internal/payload/payload_test.go` (新規)**
- `LoadJSON` — 正常 / 不在ファイル (→ ClientError) / invalid JSON (→ ClientError) / stdin (`-`)
- `LoadImage` — `.png` / `.jpg` / `.jpeg` / 拡張子なし (DetectContentType) / stdin / 不在
- テーブルテスト形式

**既存 unit tests は変更なし** (`internal/output/output_test.go`, `internal/config/*_test.go` 等)

### Integration tests (env var 必要、ローカル手動)

既存パターン (`os/exec` でビルド済バイナリ実行 → `--json` 出力パース) 踏襲。`TEST_ACCESS_TOKEN` / `TEST_USER_ID` なければ `t.Skip`。

**PR-1: `test/integration/richmenu_test.go`**

単一 lifecycle 関数 `TestRichMenuLifecycle`:
```
create → get → list → set-image → get-image → set-default → get-default
→ cancel-default → link → get-for-user → unlink → bulk-link → bulk-unlink → delete
```
全 14 コマンドを 1 フローで検証、最後に delete で side-effect 清掃。

追加: `TestRichMenuValidate` (validate のみ、side-effect なし)。

**PR-2: `test/integration/richmenu_alias_test.go` + `richmenu_batch_test.go`**

- `TestRichMenuAliasLifecycle` — alias create → list → get → update → delete
- `TestRichMenuBatchLifecycle` — RM 作成 → batch validate → batch submit → batch progress (1 回) → cleanup

### testdata

```
testdata/
├── rm.json         # 最小有効 RichMenuRequest (size: 2500x1686, 1 area)
├── rm.png          # 2500x1686 PNG (チェックイン)
├── bulk.json       # {"richMenuId":"__RM__","userIds":["__U__"]} テンプレート
└── batch_ops.json  # {"operations":[{"type":"link","from":"","to":"__RM__"}]} テンプレート
```

`__RM__` / `__U__` はテストコードで `strings.Replace` 置換。

### SDK-compat テスト

line-api-mock 側 `test/sdk-compat/rich-menu.test.ts` で Go SDK v8 の compatibility は検証済 (PR #26 / #33)。line-cli-go 側で重複しない。

### CI 動作

- `go test ./...` → unit のみ (integration は env var なしで Skip)
- CI での integration テスト自動実行は **scope 外** (既存設計の方針と一致)

## 実行テスト手順 (README に追記)

```bash
# mock 起動
cd line-api-mock && bun run dev &

# 設定
export LINE_BASE_URL=http://localhost:3000
export TEST_ACCESS_TOKEN=<mock トークン>
export TEST_USER_ID=U1234567890abcdef

# 通常利用
go build -o line-cli-go .
./line-cli-go richmenu create --payload-file test/integration/testdata/rm.json
./line-cli-go richmenu list --json

# integration test
go test ./test/integration/... -run RichMenu -v
```

## スコープ外

1. `batch progress` の `--watch` / polling 機能
2. CI での integration テスト自動実行
3. Rich menu 画像の生成・編集 (upload のみ)
4. Interactive mode / REPL
5. `richMenuSwitchAction` 用の便利 flag (postback から alias 切替) — `--payload-file` に直書きで対応
6. richmenu 複数一括 delete (LINE API に存在しない)
7. 実 LINE API での動作保証 (mock 向けデモツール)

## 実装順序 (plan 作成ヒント)

### PR-1 (15 endpoints + helper)
1. `internal/payload/` 新規 + unit tests
2. `cmd/richmenu/richmenu.go` + `cmd/root.go` 登録
3. read 系 (`list`, `get`, `get-default`, `get-for-user`) — SDK 呼び出し習得
4. simple write 系 (`delete`, `set-default`, `cancel-default`, `link`, `unlink`)
5. payload 系 (`create`, `validate`)
6. blob 系 (`set-image`, `get-image`) — content-type 判定 + stdin/stdout
7. bulk 系 (`bulk-link`, `bulk-unlink`) — flag + payload-file 二重入力
8. integration test (`TestRichMenuLifecycle`, `TestRichMenuValidate`)
9. README 更新 + 既存 design doc の「スコープ外」修正

### PR-2 (8 endpoints)
1. `cmd/richmenu/alias/` サブグループ登録
2. alias 5 コマンド
3. `cmd/richmenu/batch/` サブグループ登録
4. batch 3 コマンド (submit は `WithHttpInfo` で request id 抽出)
5. integration test (`TestRichMenuAliasLifecycle`, `TestRichMenuBatchLifecycle`)
6. README + 既存 design doc の「スコープ外」完全撤去

## ブランチ / PR 構造

- PR-1: branch `feat/line-cli-go-richmenu` (base `main`)
- PR-2: branch `feat/line-cli-go-richmenu-alias-batch` (base `main`、PR-1 マージ後に切る)

## 変更ファイル見積もり

| PR | 新規 cmd | internal | integration test | README | その他 |
|---|---|---|---|---|---|
| PR-1 | 15 ファイル ~1500 行 | `payload/` ~200 行 | ~250 行 + testdata | ~80 行 | design doc 修正 |
| PR-2 | 9 ファイル ~700 行 | なし | ~300 行 + testdata | ~40 行 | design doc 「スコープ外」撤去 |
