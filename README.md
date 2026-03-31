# conoha-cli-app-samples

[conoha-cli](https://github.com/crowdy/conoha-cli) の `app deploy` コマンドで使えるサンプルアプリ集です。

各サンプルディレクトリにはすぐにデプロイできる `compose.yml`、`Dockerfile`、ソースコードが含まれています。

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み（`conoha keypair create` で作成可能）

## 使い方

```bash
# 1. このリポジトリをクローン
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples

# 2. サーバーを作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 3. サンプルを選んでデプロイ
cd hello-world
conoha app init myserver --app-name hello-world
conoha app deploy myserver --app-name hello-world

# 4. 動作確認
conoha app logs myserver --app-name hello-world
```

## サンプル一覧

| サンプル | スタック | 説明 | 推奨フレーバー |
|---------|---------|------|--------------|
| [hello-world](hello-world/) | nginx + 静的HTML | 最もシンプルなサンプル | g2l-t-1 (1GB) |
| [nextjs](nextjs/) | Next.js (standalone) | Next.js デフォルトページ | g2l-t-2 (2GB) |
| [fastapi-ai-chatbot](fastapi-ai-chatbot/) | FastAPI + Ollama | AI チャットボット | g2l-t-4 (4GB) |
| [rails-postgresql](rails-postgresql/) | Rails + PostgreSQL | Rails scaffold アプリ | g2l-t-2 (2GB) |
| [wordpress-mysql](wordpress-mysql/) | WordPress + MySQL | WordPress ブログ | g2l-t-2 (2GB) |
| [spring-boot-postgresql](spring-boot-postgresql/) | Spring Boot + PostgreSQL | JPA CRUD アプリ | g2l-t-2 (2GB) |
| [express-mongodb](express-mongodb/) | Express.js + MongoDB | Mongoose CRUD アプリ | g2l-t-2 (2GB) |
| [laravel-mysql](laravel-mysql/) | Laravel + MySQL | Eloquent CRUD アプリ | g2l-t-2 (2GB) |
| [django-postgresql](django-postgresql/) | Django + PostgreSQL | Django ORM アプリ + 管理画面 | g2l-t-2 (2GB) |

## 自分のアプリをデプロイするには

`compose.yml`（または `docker-compose.yml`）があるディレクトリであれば、同じ手順でデプロイできます。

```bash
cd your-app
conoha app init myserver --app-name your-app
conoha app deploy myserver --app-name your-app
```

`Dockerfile` でビルドする場合は `compose.yml` の `build: .` を使ってください。

## 関連リンク

- [conoha-cli](https://github.com/crowdy/conoha-cli) — ConoHa VPS3 CLI ツール
- [ドキュメント](https://conoha-cli.jp) — チュートリアル・コマンドリファレンス
