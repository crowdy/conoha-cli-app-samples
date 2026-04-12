---
title: conoha-cliでLaravel + MySQLをConoHa VPSにワンコマンドデプロイ — 手元に PHP も Composer も入れずに
tags: Laravel PHP Conoha conoha-cli Docker
author: crowdy
slide: false
---
## はじめに

「Laravel を本番VPSで動かしたいけど、サーバーに PHP / Composer / MySQL を入れて、依存関係を整えて、`.env` を書いて、マイグレーションを走らせて……」と考えただけで億劫になりませんか？

この記事では、Laravel + MySQL の構成を ConoHa VPS3 上に `conoha app deploy` ワンコマンドでデプロイする方法を紹介します。**手元のマシンには PHP も Composer も MySQL も Node.js もインストール不要**です。ビルドはすべてサーバー上の Docker マルチステージビルドで行われるため、ローカル環境を一切汚しません。

デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使います。サーバー作成からアプリ起動まで、手元のターミナルだけで完結します。

---

## conoha-cli とは

[conoha-cli](https://github.com/crowdy/conoha-cli) は、ConoHa VPS3 をターミナルから操作するためのCLIツールです。

### 主な機能

- **サーバー管理**: VPSの作成・削除・一覧表示
- **app deploy**: `compose.yml` があるディレクトリをVPSにデプロイ
- **app logs**: コンテナログのリアルタイム表示
- **app status**: コンテナの稼働状態確認
- **環境変数管理**: `app env set` でセキュアに環境変数を注入

`app deploy` コマンドは内部でDockerとDocker Composeを自動セットアップし、ディレクトリをgit push形式でVPSへ転送してコンテナを起動します。SSHキーさえ設定すれば、コマンド1本でデプロイが完了します。

---

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み（`conoha keypair create` で作成可能）
- **手元には conoha-cli 以外何もいらない** — PHP も Composer も MySQL クライアントも不要

---

## ファイル構成

```
laravel-mysql/
├── compose.yml          # 2 サービス定義（web, db）
├── Dockerfile           # composer:2 → php:8.4-apache のマルチステージビルド
├── composer.json
├── artisan
├── bin/
│   └── docker-entrypoint  # APP_KEY 生成 + migrate を起動時に実行
├── app/
├── routes/
├── resources/
├── config/
├── database/
└── public/
```

Laravel プロジェクトの標準構成 + 2 つの設定ファイルだけです。

---

## compose.yml

```yaml
services:
  web:
    build: .
    ports:
      - "80:80"
    environment:
      - APP_ENV=production
      - APP_DEBUG=false
      - SESSION_DRIVER=file
      - DB_HOST=db
      - DB_DATABASE=laravel
      - DB_USERNAME=laravel
      - DB_PASSWORD=laravel
    depends_on:
      db:
        condition: service_healthy

  db:
    image: mysql:8.4
    environment:
      - MYSQL_ROOT_PASSWORD=rootpassword
      - MYSQL_DATABASE=laravel
      - MYSQL_USER=laravel
      - MYSQL_PASSWORD=laravel
    volumes:
      - db_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  db_data:
```

ポイントは **`web: build: .`** の一行です。これだけで「ローカルの Dockerfile を使ってサーバー上でビルドしてください」を意味します。ローカルにはビルド成果物どころか PHP すら不要です。

---

## Dockerfile（マルチステージビルド）

```dockerfile
FROM composer:2 AS deps
WORKDIR /app
COPY composer.json ./
RUN composer install --no-dev --no-scripts --prefer-dist

FROM php:8.4-apache
RUN docker-php-ext-install pdo_mysql
RUN a2enmod rewrite
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
    && sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf \
    && sed -ri -e 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf
WORKDIR /var/www/html
COPY --from=deps /app/vendor ./vendor
COPY . .
RUN chown -R www-data:www-data storage bootstrap/cache 2>/dev/null || true
RUN chmod +x bin/docker-entrypoint
EXPOSE 80
ENTRYPOINT ["bin/docker-entrypoint"]
CMD ["apache2-foreground"]
```

2 段階のマルチステージビルドです。

1. **deps ステージ** (`composer:2`): `composer.json` を読み、`composer install` で `vendor/` を生成
2. **ランタイムステージ** (`php:8.4-apache`): `pdo_mysql` 拡張を追加、Apache の DocumentRoot を `public/` に切り替え、deps ステージから `vendor/` をコピー、Laravel のソースを配置

**この構成により、ローカルマシンには `composer` も `php` もインストールする必要がありません**。すべてサーバー上の Docker ビルドコンテナで完結します。

`bin/docker-entrypoint` は Laravel 特有の初期化（`APP_KEY` の自動生成、`php artisan migrate --force`）を行うシェルスクリプトです。

```bash
#!/bin/bash
set -e

if [ ! -f .env ]; then
    echo "APP_KEY=" > .env
fi

if [ -z "$APP_KEY" ] && ! grep -q "APP_KEY=base64:" .env; then
    php artisan key:generate --force
fi

php artisan migrate --force

exec "$@"
```

---

## デプロイ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/laravel-mysql
```

### 2. サーバー作成

```bash
conoha server create --name laravel-host --flavor g2l-t-c3m2 --image ubuntu-24.04 --key mykey
```

`g2l-t-c3m2`（3 vCPU / 2GB RAM）以上を推奨します。Composer の依存解決とマイグレーションでメモリを使うため、1GB プランだとビルド中に OOM の危険があります。

### 3. アプリ初期化

```bash
conoha app init laravel-host --app-name laravel-app
```

```
Initializing app "laravel-app" on vm-e041f082-8e (160.251.139.167)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
Initialized empty Git repository in /opt/conoha/laravel-app.git/
==> Installing post-receive hook...
==> Done!

App "laravel-app" initialized on vm-e041f082-8e (160.251.139.167).
```

`app init` は初回のみ実行します。Docker・Docker Compose・git のインストールと、git リポジトリの初期化までを自動で行います。

### 4. デプロイ

```bash
conoha app deploy laravel-host --app-name laravel-app
```

ローカルの Dockerfile を使って **サーバー上で** マルチステージビルドが走ります。`composer install` も `pdo_mysql` のコンパイルもすべてサーバー側です。

```
Archiving current directory...
Uploading to vm-e041f082-8e (160.251.139.167)...
Building and starting containers...
 Image mysql:8.4 Pulling
 ...（mysql:8.4 の各レイヤーをダウンロード）...
 Image laravel-app-web Building
#1 [internal] load local bake definitions
#2 [internal] load build definition from Dockerfile
#3 [auth] library/composer:pull token
#4 [auth] library/php:pull token
#5 [internal] load .dockerignore
#6 [deps 1/3] FROM docker.io/library/composer:2
#7 [stage-1 1/9] FROM docker.io/library/php:8.4-apache
#8 [internal] load build context
#9 [deps 2/3] WORKDIR /app
#10 [deps 3/3] COPY composer.json ./
#11 [deps 4/4] RUN composer install --no-dev --no-scripts --prefer-dist
#11 ... composer がパッケージをインストール ...
#12 [stage-1 2/9] RUN docker-php-ext-install pdo_mysql
#12 ... PHP 拡張をコンパイル ...
#13 [stage-1 3/9] RUN a2enmod rewrite
#16 [stage-1 6/9] COPY --from=deps /app/vendor ./vendor
#17 [stage-1 7/9] COPY . .
#19 [stage-1 9/9] RUN chmod +x bin/docker-entrypoint
#20 exporting to image
#20 naming to docker.io/library/laravel-app-web:latest done
 Image laravel-app-web Built
 Network laravel-app_default Created
 Volume laravel-app_db_data Created
 Container laravel-app-db-1 Created
 Container laravel-app-web-1 Created
 Container laravel-app-db-1 Started
 Container laravel-app-db-1 Waiting
 Container laravel-app-db-1 Healthy
 Container laravel-app-web-1 Started
NAME                IMAGE             STATUS                    PORTS
laravel-app-db-1    mysql:8.4         Up 11 seconds (healthy)   3306/tcp, 33060/tcp
laravel-app-web-1   laravel-app-web   Up Less than a second     0.0.0.0:80->80/tcp
Deploy complete.
```

healthcheck により MySQL が Ready になってから web の起動が始まります（「Waiting → Healthy」の遷移）。

### 5. コンテナ状態の確認

```bash
conoha app status laravel-host --app-name laravel-app
```

```
NAME                IMAGE             STATUS                    PORTS
laravel-app-db-1    mysql:8.4         Up 1 minute (healthy)     3306/tcp, 33060/tcp
laravel-app-web-1   laravel-app-web   Up 18 seconds             0.0.0.0:80->80/tcp
```

---

## 動作確認

ブラウザで `http://<サーバーIP>` にアクセスすると、シンプルな投稿一覧ページが表示されます。

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Laravel on ConoHa</title>
  ...
</head>
<body>
  <h1>Laravel on ConoHa</h1>
  <div class="form-box">
    ...投稿フォーム...
  </div>
</body>
</html>
```

`curl` で確認するとこんな感じです。

```bash
$ curl -s -o /dev/null -w "HTTP %{http_code}, %{size_download} bytes\n" http://160.251.139.167/
HTTP 200, 1638 bytes
```

`bin/docker-entrypoint` が `php artisan migrate --force` を実行しているので、ブラウザでアクセスした時点で `posts` テーブルもすでに作成されています。フォームから投稿すると Eloquent ORM 経由で MySQL に保存され、一覧に表示されます。

---

## 「ローカルに何も入れない」とは具体的にどういうことか

今回のデプロイで、私の手元のマシンには **以下のいずれもインストールしていません**。

| ローカルに不要だったもの | 理由 |
|---|---|
| **PHP** | サーバー上の `php:8.4-apache` イメージで実行 |
| **Composer** | サーバー上の `composer:2` イメージでビルド |
| **`pdo_mysql` 拡張** | 同上、Dockerfile の `docker-php-ext-install` でビルド |
| **MySQL クライアント** | デプロイ後の動作確認はブラウザだけで完結 |
| **Node.js / npm** | このサンプルでは未使用（フロントが必要なら同様にサーバー側ビルド可能） |
| **Docker** | サーバー側にだけあれば良い。ローカルでビルド検証はしない |

必要なのは **`conoha-cli` だけ**です。手元の Mac / WSL / Linux ノートに `composer install` を走らせる必要も、PHP のバージョン違いに悩まされる必要もありません。

これは Laravel に限った話ではありません。同じリポジトリには [Rails + PostgreSQL](https://github.com/crowdy/conoha-cli-app-samples/tree/main/rails-postgresql)、[Django + PostgreSQL](https://github.com/crowdy/conoha-cli-app-samples/tree/main/django-postgresql)、[Spring Boot + PostgreSQL](https://github.com/crowdy/conoha-cli-app-samples/tree/main/spring-boot-postgresql)、[NestJS + PostgreSQL](https://github.com/crowdy/conoha-cli-app-samples/tree/main/nestjs-postgresql)、[Next.js + FastAPI + PostgreSQL](https://github.com/crowdy/conoha-cli-app-samples/tree/main/nextjs-fastapi-postgresql) など、30 以上のフレームワークサンプルが収録されています。どれも同じ「ローカルにランタイムを入れない」アプローチでデプロイできます。

---

## ハマりポイント: MySQL healthcheck の race condition

実機検証中にひとつ罠を踏みました。`mysql:8.4` の healthcheck `mysqladmin ping -h localhost` は、**MySQL の初期化中に立ち上がる「temporary server」フェーズで既に成功を返します**。しかしこの時点では本番 mysqld の TCP リスナーはまだ起動していません。

具体的には MySQL 初期化のタイムラインはこうなっています:

```
00:37:38  entrypoint script start
00:37:39  initializing db files
00:37:45  init done, starting temporary server  ← この時点で mysqladmin ping は成功する
00:37:49  stopping temporary server (laravel DB を作成)
00:37:50  final mysqld starting
00:37:51  ready for connections on port 3306    ← 本当の Ready
```

compose の healthcheck は `00:37:45` の時点で「healthy」を出してしまうため、`depends_on: condition: service_healthy` を信じた web コンテナが先に起動し、`bin/docker-entrypoint` 内の `php artisan migrate --force` が `SQLSTATE[HY000] [2002] Connection refused` で死亡します。

おまけに `compose.yml` の `web` サービスには `restart: unless-stopped` が指定されていないため、一度死んだコンテナはそのままです。`conoha app status` で見ると `web-1` の行が消えています。

```
NAME               IMAGE       STATUS                    PORTS
laravel-app-db-1   mysql:8.4   Up 49 seconds (healthy)   3306/tcp, 33060/tcp
              ↑ web が消えている
```

### 復旧方法

MySQL がしばらく動いて完全に Ready になってから、もう一度 `conoha app deploy` を打つだけで復旧します。2 回目はビルドキャッシュが効いて 5 秒程度で web コンテナが Recreate され、今度は migrate も通ります。

```bash
conoha app deploy laravel-host --app-name laravel-app
```

```
 Container laravel-app-db-1 Running
 Container laravel-app-web-1 Recreate
 Container laravel-app-web-1 Recreated
 Container laravel-app-db-1 Waiting
 Container laravel-app-db-1 Healthy
 Container laravel-app-web-1 Starting
 Container laravel-app-web-1 Started
NAME                IMAGE             STATUS                  PORTS
laravel-app-db-1    mysql:8.4         Up 1 minute (healthy)   3306/tcp, 33060/tcp
laravel-app-web-1   laravel-app-web   Up 18 seconds           0.0.0.0:80->80/tcp
```

### 恒久対策

サンプルを fork して使う場合は、以下の 2 箇所を直すと race を踏みません。

1. **healthcheck を TCP プローブに変える** — `localhost` への ping だと内部ソケット経由で温まる前に成功してしまうので、明示的に TCP を叩く

   ```yaml
       healthcheck:
         test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "--protocol=tcp"]
         interval: 5s
         timeout: 5s
         retries: 10
         start_period: 20s
   ```

2. **web サービスに `restart: unless-stopped` を追加** — 万一 race を踏んでも自動復旧

   ```yaml
     web:
       build: .
       restart: unless-stopped
       ports:
         - "80:80"
   ```

別解として、`bin/docker-entrypoint` の中で `php artisan migrate` をリトライ付きにする方法もあります。

---

## まとめ

| 項目 | 内容 |
|---|---|
| デプロイ対象 | Laravel 13 + PHP 8.4 + MySQL 8.4 |
| 必要コマンド | `app init` + `app deploy` の 2 つ |
| ローカル環境の要件 | **conoha-cli のみ**（PHP / Composer / MySQL クライアントは不要） |
| 推奨フレーバー | g2l-t-c3m2（3 vCPU / 2GB RAM） |
| 外部公開ポート | 80 のみ |
| ソースコード | [crowdy/conoha-cli-app-samples](https://github.com/crowdy/conoha-cli-app-samples/tree/main/laravel-mysql) |

`compose.yml` と `Dockerfile` さえ用意すれば、`conoha app deploy` ひとつで Laravel のフルスタックがサーバー上で組み上がります。**手元に PHP も Composer もないノートパソコンから、本番 VPS に Laravel アプリをデプロイできる** — これが今回のいちばん伝えたかったポイントです。

実機検証で MySQL healthcheck の race を踏んだのは想定外でしたが、`conoha app deploy` をもう一度打つだけで復旧する程度の小さな罠でした。サンプルを実運用するなら ハマりポイントセクションの修正を取り込むことをお勧めします。

### 参考

- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)

