# dify-https

AI ワークフロー・エージェント構築プラットフォーム。RAG、チャットボット、ワークフロー自動化を GUI で構築できます。

## 構成

- [Dify](https://dify.ai/) v0.15 — AI プラットフォーム（API + Worker + Web）
- PostgreSQL 16 — データベース
- Redis 7 — キャッシュ・キュー
- nginx — リバースプロキシ
- ポート: 80（Web UI）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成（4GB 以上推奨）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定（このステップは必須 — compose のデフォルトは
#    公開リポジトリに記載されています）
conoha app env set myserver \
  SECRET_KEY=$(openssl rand -hex 32) \
  DB_PASSWORD=$(openssl rand -base64 32) \
  REDIS_PASSWORD=$(openssl rand -base64 32)

# 6. デプロイ
conoha app deploy myserver
```

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスし、初期管理者アカウントを作成します。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。HTTPS 終端は conoha-proxy が Let's Encrypt で自動処理するため、`nginx.conf` 側の証明書設定は不要になりました。

## 既知の制限: blue/green の適用範囲

このサンプルでは **nginx のみが blue/green 対象** で、Dify 本体の `api` / `worker` / `web` / `db` / `redis` は accessory として宣言されています:

- nginx 設定だけ変えて再デプロイ → 新スロットの nginx が立ち上がる（通常動作）
- `api` / `web` のコードや image を更新して再デプロイ → **accessory なので新スロットでは再起動されない**（旧コンテナが使われ続ける）

Dify 本体の更新を独立した blue/green 切替で流したい場合、`api` / `worker` / `web` を別 `conoha.yml` プロジェクトに切り出して、`api.dify.example.com` / `app.dify.example.com` などのサブドメインで proxy 下に並べる構成が必要です。future batch で対応検討中。

## カスタマイズ

- OpenAI、Anthropic、Ollama などの LLM プロバイダーを設定 > モデルプロバイダーから追加
- ナレッジベース機能で RAG を構築（PDF、Markdown などをアップロード）
