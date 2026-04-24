# meilisearch

Algolia 代替の高速セルフホスティング全文検索エンジン。タイポ耐性、ファセット検索、日本語対応を備えた RESTful API を提供します。

## 構成

- [Meilisearch](https://www.meilisearch.com/) v1.13 — 全文検索エンジン
- ポート: 7700（REST API + ミニダッシュボード）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成
conoha server create --name myserver --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定（master key は自分で生成）
#    このステップは必須です。スキップすると compose.yml のデフォルト値
#    (change-me-to-a-secure-master-key) のままデプロイされ、外部から
#    全 API が叩ける状態になります。
conoha app env set myserver MEILI_MASTER_KEY=$(openssl rand -base64 32)

# 6. デプロイ
conoha app deploy myserver
```

## 動作確認

```bash
# ドキュメントを追加
curl -X POST "https://<あなたの FQDN>/indexes/movies/documents" \
  -H "Authorization: Bearer <MEILI_MASTER_KEY>" \
  -H "Content-Type: application/json" \
  --data-binary '[
    {"id": 1, "title": "千と千尋の神隠し", "genre": "アニメ"},
    {"id": 2, "title": "もののけ姫", "genre": "アニメ"},
    {"id": 3, "title": "天気の子", "genre": "アニメ"}
  ]'

# 検索（タイポ耐性あり）
curl "https://<あなたの FQDN>/indexes/movies/search?q=千と千尋" \
  -H "Authorization: Bearer <MEILI_MASTER_KEY>"
```

`<MEILI_MASTER_KEY>` は step 5 で `conoha app env set` に渡した値に置き換えてください。

ブラウザで `https://<あなたの FQDN>` にアクセスするとミニダッシュボードも利用可能です。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## カスタマイズ

- 日本語トークナイザーが組み込み済み（設定不要）
- フロントエンド向け SDK: JavaScript、React、Vue、Svelte など
- Strapi や WordPress と連携してコンテンツ検索に利用可能
- 本番環境では `MEILI_MASTER_KEY` を必ず安全な値に変更してください
