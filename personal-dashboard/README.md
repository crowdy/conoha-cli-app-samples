# personal-dashboard

時計・天気（気象庁 JMA）・カレンダー（Outlook / Google）・カウントダウン・ショートカットを 1 画面にまとめた**自分用ダッシュボード**。Go + Next.js のシングルバイナリを Caddy 経由で配信し、TLS は **Cloudflare Origin CA 証明書**（15 年有効）で終端します。

**ライブデモ**: <https://dashboard.crowdy.dev>
**フルソース**: <https://github.com/crowdy/dashboard.crowdy.dev>

## このサンプルの位置づけ

本リポジトリで **conoha-cli の no-proxy モード + Caddy + Cloudflare Origin CA** パターンを使う唯一のサンプルです。

| サンプル | TLS の取り方 | conoha-cli モード |
|---|---|---|
| [`nextjs`](../nextjs/) / [`hello-world`](../hello-world/) | conoha-proxy が Let's Encrypt 取得 | proxy（`conoha.yml`）|
| [`vllm-gpu`](../vllm-gpu/) | Caddy が Let's Encrypt 自動取得（HTTP-01）| no-proxy |
| **`personal-dashboard`（本サンプル）** | **Cloudflare Origin CA（手動発行・15 年）** | **no-proxy** |

Origin CA を選ぶ理由は後述の「Cloudflare Origin CA を選ぶ理由」を参照してください。

## アーキテクチャ

```
Browser ─── HTTPS ──▶ Cloudflare edge (Universal SSL)
                          │
                          │ HTTPS (Full Strict, CF が Origin CA を検証)
                          ▼
                     Caddy (VPS 上のコンテナ)
                          │ HTTP (compose internal network)
                          ▼
                     Go binary  ───▶  SQLite
                     (Next.js static export を go:embed)
```

- **フロント**: Next.js 14（`output: 'export'` で静的ファイル化）
- **バックエンド**: Go 1.26（Next.js の `out/` を `go:embed` で同一バイナリに梱包）
- **DB**: SQLite（`modernc.org/sqlite` ピュア Go ドライバ・CGO 不要）
- **TLS 終端**: Caddy 2（Origin CA 証明書をマウントして利用、ACME は使わない）
- **CDN/WAF**: Cloudflare（オレンジクラウド = プロキシ ON、SSL モードは Full (Strict)）

## 機能

- 大型デジタル時計（1 秒更新、テーマ切替対応）
- 気象庁 JMA の今日 / 明日予報（30 分キャッシュ）
- 複数アカウントのカレンダー集約（Microsoft Outlook + Google Calendar 任意・複数可）
- カウントダウンタイマー（年末まで、誕生日まで、等。SQLite に永続化）
- アイコン付きショートカット（`SHORTCUTS` 環境変数で JSON 配列指定）
- ライト / ダークテーマ（OS 設定追従 + 手動切替 + `localStorage` 永続化）

更新頻度: 時計 1 秒 / カウントダウン 1 秒 / 予定 5 分 / 天気 30 分（サーバー側 TTL は環境変数で調整可）。

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) インストール済み
- ConoHa VPS3 アカウント + SSH キーペア
- **Cloudflare で管理しているドメイン**（オレンジクラウド = プロキシ ON）
- Cloudflare API トークン（権限 2 つ必要）
  - `Zone : DNS : Edit` — DNS レコード作成用（手動でやるなら不要）
  - `SSL and Certificates : Edit` — Origin CA 発行用（**こちらは必須**）
- ローカルに `openssl`, `jq`, `curl`

## デプロイ手順

### 1. VPS を作る（Docker プリインストール済みイメージ）

```bash
conoha server create --name dashboard-server \
  --flavor f2a77529-1815-43a2-bc14-1f3f6b09079c \
  --image 722c231f-3f61-4e79-a5a6-c70d6c9ea908 \
  --key-name <your-key> \
  --security-group default \
  --security-group IPv4v6-SSH \
  --security-group IPv4v6-Web \
  --no-input --yes --wait
```

`g2l-t-2`（2GB）でも動きます。Docker プリインストール済みイメージを使うと初期セットアップが省けます。

### 2. Cloudflare Origin CA 証明書を発行する

```bash
export CF_API_TOKEN=...   # SSL and Certificates: Edit 権限のトークン
./scripts/issue-cf-origin-cert.sh dashboard.example.com
```

ローカルの `./certs/` 配下に `dashboard.example.com.crt` と `dashboard.example.com.key` ができます。**15 年有効** なので、運用中の自動更新は基本不要です（権限を絞っていれば失効リスクも低い）。

### 3. 証明書を VPS にコピーする

```bash
VPS=root@<vps-ip>
ssh $VPS 'mkdir -p /etc/caddy/certs && chmod 700 /etc/caddy/certs'
scp certs/dashboard.example.com.{crt,key} $VPS:/etc/caddy/certs/
ssh $VPS 'chmod 644 /etc/caddy/certs/*.crt && chmod 600 /etc/caddy/certs/*.key'
```

`docker-compose.yml` で `/etc/caddy/certs` を read-only マウントしているので、Caddy コンテナからそのまま参照されます。

### 4. Caddyfile のドメインを書き換える

`caddy/Caddyfile` 内の `<YOUR-DOMAIN>` をあなたのホスト名（例: `dashboard.example.com`）にすべて置換してください。

```bash
sed -i 's/<YOUR-DOMAIN>/dashboard.example.com/g' caddy/Caddyfile
```

### 5. DNS を Cloudflare に追加（オレンジクラウド ON）

`dashboard` → VPS IP の A レコードを作成、**Proxy status は Proxied（オレンジ雲）**。SSL/TLS 設定は **Full (Strict)** にしてください（Origin CA は CF が検証してくれます）。

### 6. デプロイ

```bash
# 初回登録
conoha app init dashboard-server --app-name dashboard --no-proxy

# デプロイ（マルチステージビルドで Go + Node を順に実行、数分かかります）
conoha app deploy dashboard-server --app-name dashboard --no-proxy
```

### 7. 動作確認

```bash
curl https://dashboard.example.com/api/health
# → {"ok":true}
```

ブラウザでアクセスすると時計とウィジェットが表示されます。

## 設定 (`.env.example` 参照)

`docker-compose.yml` の `environment:` セクションに直接書くか、`conoha app env set` で外出ししても OK です（外出しする場合、コンフリクトしないよう compose 側からそのキーを削除してください）。

| 変数 | 説明 | デフォルト |
|---|---|---|
| `PORT` | バックエンド待ち受けポート（Caddy → Go） | `8080` |
| `DB_PATH` | SQLite ファイルパス | `/app/data/dashboard.db` |
| `BRAND_NAME` | ヘッダーに表示するブランド名 | `"My Dashboard"` |
| `JMA_OFFICE_CODE` | 気象庁 office コード（例: 東京 = `130000`）| `130000` |
| `JMA_CITY_LABEL` | 予報に表示する市区町村ラベル | `渋谷区` |
| `MS_TENANT_ID` 他 4 つ | Microsoft Outlook 連携（空なら無効化） | 空 |
| `GOOGLE_ACCOUNTS` | Google Calendar アカウント情報の JSON 配列（空なら無効化） | `[]` |
| `SHORTCUTS` | ショートカットボタンの JSON 配列 | `[]` |
| `SCHEDULE_TTL_SECONDS` | 予定取得のサーバーキャッシュ TTL（秒） | `300` |
| `WEATHER_TTL_SECONDS` | 天気のサーバーキャッシュ TTL（秒） | `1800` |

### JMA Office コード

東京 23 区 `130000`、大阪 `270000`、福岡 `400000` など。完全な一覧は [JMA 公開 JSON](https://www.jma.go.jp/bosai/common/const/area.json) を参照。

### Outlook 連携

`MS_TENANT_ID` をセットすると有効化されます。その場合、`MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_REFRESH_TOKEN` も必須です。Microsoft Entra ID（旧 Azure AD）でアプリを登録し、`Calendars.Read` 権限を付与し、Authorization Code Flow で取得した refresh token を投入します。

### Google Calendar 連携

`GOOGLE_ACCOUNTS` に JSON 配列を入れます。複数アカウントの予定をマージして 1 リストとして表示します:

```json
[
  {
    "label": "Personal",
    "client_id": "...",
    "client_secret": "...",
    "refresh_token": "...",
    "calendar_id": "primary"
  }
]
```

### ショートカット

`SHORTCUTS` も JSON 配列。アイコン画像は `web/public/icons/` に置くか、絶対 URL を指定します:

```json
[
  {"label": "GitHub", "url": "https://github.com", "icon": "/icons/github.svg"},
  {"label": "Mail",   "url": "https://mail.google.com"}
]
```

## Cloudflare Origin CA を選ぶ理由

Caddy なら **Let's Encrypt の DNS-01**（`caddy-dns/cloudflare` プラグイン + `Zone : DNS : Edit` トークン）でも自動取得できます。なぜ Origin CA を採用したか:

| 比較項目 | Let's Encrypt (DNS-01) | Cloudflare Origin CA |
|---|---|---|
| 有効期間 | 90 日（自動更新前提） | **15 年** |
| 更新の運用負荷 | プラグイン経由で自動・但し障害発生時の追跡必要 | 基本ゼロ（Cloudflare の Origin CA root 自体は別管理） |
| 必要な Caddy プラグイン | `caddy-dns/cloudflare`（カスタムビルド） | **不要**（標準 Caddy で OK） |
| ACME 用ポート | 80/443 を外に晒す必要あり（HTTP-01 の場合） | 不要（外部到達性に依存しない） |
| 真の TLS 信頼チェーン | パブリック CA | **CF のみが信頼** |

**最後の点が肝**で、Origin CA 証明書は Cloudflare の Edge からしか信頼されません。これは弱点ではなく**前提**で、CF プロキシ（オレンジクラウド）越しでしかアクセスさせない構成では問題になりません。むしろ「Origin 直 IP に LE 証明書貼って漏らす」というよくあるオペレーションミスを構造的に防げます。

**トレードオフ**: 将来 CF プロキシを外す（グレークラウドに変更）と Origin CA 証明書は意味を失います。その場合は LE 等に切り替えてください。

## 運用

```bash
# ログ追従
conoha app logs dashboard-server --app-name dashboard --follow

# 再起動
conoha app restart dashboard-server --app-name dashboard

# コード変更後の再デプロイ
conoha app deploy dashboard-server --app-name dashboard --no-proxy
```

SQLite ファイルは `./data/dashboard.db` にバインドマウントされます。バックアップは VPS 側でこのファイルをコピーするだけで足ります。

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `curl: (60) SSL certificate problem` | CF 側 DNS のプロキシが OFF（グレー雲）になっている。オレンジに戻す |
| ブラウザで「保護されていない通信」 | 上記と同じ理由か、SSL/TLS モードが Full (Strict) でない |
| `tls: error reading server's CertificateRequest` | Caddy のマウント先 `/etc/caddy/certs` に `*.crt` / `*.key` が無い |
| 502 Bad Gateway | `web` コンテナが落ちている。`docker compose logs web` で確認 |
| Outlook 予定が出ない | `MS_*` 4 変数すべて埋まっているか、refresh token の有効期限を確認 |
| 天気が出ない | `JMA_OFFICE_CODE` が誤り。`https://www.jma.go.jp/bosai/forecast/data/forecast/<code>.json` が 200 を返すコードを使う |

## ローカル開発

```bash
make dev    # web と api を並行起動
make build  # 単一バイナリを dist/dashboard に
make test   # Go と Vitest の両方
```

## 関連リンク

- [conoha-cli](https://github.com/crowdy/conoha-cli)
- [Cloudflare Origin CA API](https://developers.cloudflare.com/api/operations/origin-ca-create-certificate)
- [Caddy `tls` directive](https://caddyserver.com/docs/caddyfile/directives/tls)
- フルソース・実運用環境: <https://github.com/crowdy/dashboard.crowdy.dev>
