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

## デプロイ

```bash
# サーバー作成（4GB 以上推奨）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name dify-https

# 環境変数を設定
conoha app env set myserver --app-name dify-https \
  SECRET_KEY=your-random-secret-key \
  DB_PASSWORD=your-secure-password \
  REDIS_PASSWORD=your-secure-password

# デプロイ
conoha app deploy myserver --app-name dify-https
```

## 動作確認

ブラウザで `http://<サーバーIP>` にアクセスし、初期管理者アカウントを作成します。

## カスタマイズ

- OpenAI、Anthropic、Ollama などの LLM プロバイダーを設定 > モデルプロバイダーから追加
- ナレッジベース機能で RAG を構築（PDF、Markdown などをアップロード）
- HTTPS 化する場合は nginx.conf を編集し Let's Encrypt 証明書を設定
- 本番環境では `SECRET_KEY`、`DB_PASSWORD`、`REDIS_PASSWORD` を必ず変更してください
