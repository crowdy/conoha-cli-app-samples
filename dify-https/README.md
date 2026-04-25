# dify-https

AI ワークフロー・エージェント構築プラットフォーム。RAG、チャットボット、ワークフロー自動化を GUI で構築できます。

> **必須**: `conoha-cli >= v0.6.1`。v0.6.1 未満では `expose:` ブロックの blue/green スロットが proxy ターゲットとして登録されない既知の不具合があります（[conoha-cli#163](https://github.com/) 参照）。

## 構成

- [Dify](https://dify.ai/) v0.15 — AI プラットフォーム（API + Worker + Web）
- PostgreSQL 16 — データベース
- Redis 7 — キャッシュ・キュー
- nginx — リバースプロキシ（root FQDN、Web UI のフォールバック用）
- ポート: 80（nginx）、5001（api）、3000（web）

### サブドメイン構成（issue #54）

このサンプルは **3 つの FQDN** を使い分けます:

| FQDN                       | サービス | ポート | blue/green | 用途                          |
| -------------------------- | -------- | ------ | ---------- | ----------------------------- |
| `dify-https.example.com`   | nginx    | 80     | yes        | 旧来の nginx ルーティング     |
| `api.example.com`          | api      | 5001   | yes        | Dify API（直接公開）          |
| `web.example.com`          | web      | 3000   | yes        | Dify Web UI（Next.js 直接）   |

`api` / `web` をそれぞれ独立した subdomain で proxy 下に並べることで、 `app deploy` 時に **両者ともスロット切替（blue/green）が効きます**。

## 前提条件

- `conoha-cli >= v0.6.1` がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- 公開する **3 つの FQDN** すべての DNS A レコードがサーバー IP を指している（root + api + web）

## デプロイ

```bash
# 1. サーバー作成（4GB 以上推奨）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` および `expose:` の `host:` を自分の FQDN に書き換える
#    - hosts[]            -> root FQDN（例: dify-https.example.com）
#    - expose[label=api]  -> api 用 FQDN（例: api.example.com）
#    - expose[label=web]  -> web 用 FQDN（例: web.example.com）

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定（必須 — compose のデフォルトは公開リポジトリに記載されています）
conoha app env set myserver \
  SECRET_KEY=$(openssl rand -hex 32) \
  DB_PASSWORD=$(openssl rand -base64 32) \
  REDIS_PASSWORD=$(openssl rand -base64 32) \
  CONSOLE_API_URL=https://api.example.com \
  APP_API_URL=https://api.example.com \
  SERVICE_API_URL=https://api.example.com \
  APP_WEB_URL=https://web.example.com

# 6. デプロイ
conoha app deploy myserver
```

`CONSOLE_API_URL` / `APP_API_URL` は **Dify web のブラウザ向けバンドルに焼き込まれる** ため、必ず `https://api.<your domain>` の形にしてください。`api.example.com` のままだとログイン後 API 呼び出しが ERR_NAME_NOT_RESOLVED になります。

## 動作確認

ブラウザで `https://web.<あなたの FQDN>` にアクセスし、初期管理者アカウントを作成します。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。HTTPS 終端は conoha-proxy が自動処理します。

`https://<root FQDN>` でも nginx の location ルールにより同じ画面に到達できますが、新しい subdomain 構成では `web.` を正規入口として扱う想定です。

ヘルスチェックパス:

- root (nginx): `/` — nginx の default location が 200 を返す
- api: `/health` — Dify api Flask アプリが `{"pong":"pong"}` を返す
- web: `/` — Next.js サーバの index ページ（Dify web には専用 `/api/health` が無いためフォールバック）

> **Note**: web の health に `/` を使っているため、コンテナの起動が遅い（初回 Next.js ビルドが走る）と `unhealthy_threshold` を 24 に設定済み（120 秒）でも tight になる可能性があります。proxy のログで unhealthy が出る場合は `conoha.yml` の `unhealthy_threshold` をさらに上げてください。

## 既知の制限: worker は accessory のまま

`worker` は HTTP を喋らないバックグラウンドサービスなので **expose: ブロックには載せられません**（spec §1.3 内部専用 blue/green は今回の対象外）。`worker` は accessory として残るため、`app deploy` で **worker 側コンテナはスロット切替されず再利用されます**。

実害として、新スロットの `api` / `web` がコード更新を反映している間、`worker` は **旧コードのまま動き続ける** タイミングが発生し得ます。Dify のジョブ仕様変更を伴う update では、デプロイ後に明示的に worker を再起動してください:

```bash
ssh myserver -- 'docker compose -p dify-https-acc restart worker'
```

internal-only blue/green を spec §1.3 の next batch で対応予定です。

## カスタマイズ

- OpenAI、Anthropic、Ollama などの LLM プロバイダーを設定 > モデルプロバイダーから追加
- ナレッジベース機能で RAG を構築（PDF、Markdown などをアップロード）
