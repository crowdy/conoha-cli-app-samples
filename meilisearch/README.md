# meilisearch

Algolia 代替の高速セルフホスティング全文検索エンジン。タイポ耐性、ファセット検索、日本語対応を備えた RESTful API を提供します。

## 構成

- [Meilisearch](https://www.meilisearch.com/) v1.13 — 全文検索エンジン
- ポート: 7700（REST API + ミニダッシュボード）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name meilisearch

# 環境変数を設定
conoha app env set myserver --app-name meilisearch \
  MEILI_MASTER_KEY=$(openssl rand -base64 32)

# デプロイ
conoha app deploy myserver --app-name meilisearch
```

## 動作確認

```bash
# ドキュメントを追加
curl -X POST "http://<サーバーIP>:7700/indexes/movies/documents" \
  -H "Authorization: Bearer <MEILI_MASTER_KEY>" \
  -H "Content-Type: application/json" \
  --data-binary '[
    {"id": 1, "title": "千と千尋の神隠し", "genre": "アニメ"},
    {"id": 2, "title": "もののけ姫", "genre": "アニメ"},
    {"id": 3, "title": "天気の子", "genre": "アニメ"}
  ]'

# 検索（タイポ耐性あり）
curl "http://<サーバーIP>:7700/indexes/movies/search?q=千と千尋" \
  -H "Authorization: Bearer <MEILI_MASTER_KEY>"
```

ブラウザで `http://<サーバーIP>:7700` にアクセスするとミニダッシュボードも利用可能です。

## カスタマイズ

- 日本語トークナイザーが組み込み済み（設定不要）
- フロントエンド向け SDK: JavaScript、React、Vue、Svelte など
- Strapi や WordPress と連携してコンテンツ検索に利用可能
- 本番環境では `MEILI_MASTER_KEY` を必ず安全な値に変更してください
