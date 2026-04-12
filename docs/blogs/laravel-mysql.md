---
title: conoha-cliでLaravel + MySQLアプリをConoHa VPSにワンコマンドデプロイ
tags: Laravel MySQL Docker Conoha conoha-cli
author: crowdy
slide: false
---
## はじめに

Laravel アプリを自前のVPSにデプロイしたいけど、PHPやComposerのローカルセットアップが面倒——そう思っていませんか？

この記事では、**Laravel 13 + MySQL 8.4** の投稿アプリを、ConoHa VPS3 上に `conoha app deploy` ワンコマンドでデプロイする方法を紹介します。

ポイントは、**ローカル環境にPHPもComposerも不要**ということです。Dockerのマルチステージビルドにより、依存パッケージのインストールやアプリのセットアップはすべてサーバー側で行われます。手元にはDockerすら要りません。

デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使います。サーバー作成からアプリ起動まで、手元のターミナルだけで完結します。

---

## ポイント: ローカル環境にPHPは不要

```
┌─────────────┐          tar + SSH          ┌──────────────────────┐
│  local PC   │  ─────────────────────────→ │    ConoHa VPS3       │
│             │   ソースコードだけ送信        │                      │
│  no PHP     │                             │  composer install    │
│  no Composer│                             │  php artisan migrate │
│  no Docker  │                             │  startApache         │
└─────────────┘                             └──────────────────────┘
```

`conoha app deploy` を実行すると、ローカルのソースコードがVPSに転送され、サーバー上でDockerビルドが走ります。Composerの依存解決もマイグレーションもコンテナ起動時に自動実行されるため、ローカルPCには何もインストールする必要がありません。

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

---

## ファイル構成

```
laravel-mysql/
├── Dockerfile
├── compose.yml
├── composer.json
├── artisan
├── app/
│   ├── Http/Controllers/PostController.php
│   ├── Models/Post.php
│   └── Providers/AppServiceProvider.php
├── bin/
│   └── docker-entrypoint
├── bootstrap/
│   ├── app.php
│   └── providers.php
├── config/
│   ├── app.php
│   ├── database.php
│   └── session.php
├── database/
│   └── migrations/
│       └── 2026_01_01_000000_create_posts_table.php
├── public/
│   ├── .htaccess
│   └── index.php
├── resources/
│   └── views/posts/index.blade.php
├── routes/
│   └── web.php
└── storage/
    ├── framework/
    └── logs/
```

---

## Dockerfile

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

**マルチステージビルド**を採用しています。

- **ステージ1（deps）**: `composer:2` イメージで `composer install` を実行。ローカルにComposerがなくても、ここで依存パッケージがすべてインストールされます。
- **ステージ2**: `php:8.4-apache` イメージにvendorディレクトリをコピーし、Apacheの設定を調整。

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

`depends_on` の `condition: service_healthy` により、MySQLが完全に起動してからWebコンテナが開始されます。

---

## docker-entrypoint

```bash
#!/bin/bash
set -e

# Create .env file with APP_KEY placeholder if it does not exist
if [ ! -f .env ]; then
    echo "APP_KEY=" > .env
fi

# Generate app key if not set
if [ -z "$APP_KEY" ] && ! grep -q "APP_KEY=base64:" .env; then
    php artisan key:generate --force
fi

# Run database migrations
php artisan migrate --force

exec "$@"
```

コンテナ起動時に以下を自動実行します:

1. `.env` ファイルがなければ作成
2. `APP_KEY` が未設定なら `php artisan key:generate` で生成
3. `php artisan migrate --force` でDBマイグレーション実行

これにより、初回デプロイ時も再デプロイ時も、手動でのセットアップは一切不要です。

---

## アプリケーションコード

### PostController

```php
class PostController
{
    public function index()
    {
        $posts = Post::orderBy('created_at', 'desc')->get();
        return view('posts.index', compact('posts'));
    }

    public function store(Request $request)
    {
        $request->validate(['title' => 'required|string|max:255']);
        Post::create($request->only('title', 'body'));
        return redirect('/');
    }

    public function destroy(Post $post)
    {
        $post->delete();
        return redirect('/');
    }
}
```

シンプルなCRUD（Create / Read / Delete）の投稿アプリです。Eloquent ORMを使い、バリデーションも含めて最小限のコードで実装しています。

---

## デプロイ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/laravel-mysql
```

### 2. サーバー作成（まだない場合）

```bash
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey --wait
```

### 3. アプリ初期化

```bash
conoha app init myserver --app-name laravel-app
```

### 4. デプロイ

```bash
conoha app deploy myserver --app-name laravel-app
```

```
Archiving current directory...
Uploading to vm-18268c66-ae (133.88.116.147)...
Building and starting containers...
 Image mysql:8.4 Pulling
 ...
 Image mysql:8.4 Pulled
 Image laravel-mysql-web Building
 ...
 Image laravel-mysql-web Built
 Container laravel-mysql-db-1 Started
 Container laravel-mysql-db-1 Healthy
 Container laravel-mysql-web-1 Started
NAME                  IMAGE               SERVICE   STATUS
laravel-mysql-db-1    mysql:8.4           db        Up (healthy)
laravel-mysql-web-1   laravel-mysql-web   web       Up
Deploy complete.
```

これだけです。ローカルでの `composer install` も `php artisan` も不要。ソースコードを送るだけで、ビルドからマイグレーションまですべてサーバー側で完結します。

---

## 動作確認

### コンテナ状態

```bash
conoha app status myserver --app-name laravel-app
```

```
NAME                  IMAGE               SERVICE   CREATED         STATUS
laravel-mysql-db-1    mysql:8.4           db        2 minutes ago   Up 2 minutes (healthy)
laravel-mysql-web-1   laravel-mysql-web   web       2 minutes ago   Up 2 minutes
```

### ブラウザでアクセス

`http://<サーバーIP>` にアクセスすると、投稿一覧ページが表示されます。

- タイトルと本文を入力して **Create Post** → 投稿が作成される
- **Delete** ボタン → 投稿が削除される

DBマイグレーションとAPP_KEY生成はコンテナ起動時に自動実行されているので、ブラウザを開いた瞬間からアプリが使えます。

---

## ハマりポイント: なし

WordPressやNext.jsの記事と同様、**特にハマりポイントはありませんでした**。

Dockerfileでマルチステージビルドを使い、docker-entrypointでマイグレーションとキー生成を自動化しているため、`conoha app deploy` 一発で初回からすべてが動きます。

強いて言えば、Laravel 13ではセッションのデフォルトドライバが `database` に変更されたため、セッション用テーブルを用意しない場合は `SESSION_DRIVER=file` を明示する必要がある点くらいです。これは `compose.yml` の環境変数で対応しています。

---

## まとめ

| 項目 | 内容 |
|---|---|
| アクセスURL | `http://<サーバーIP>/` |
| 使用技術 | Laravel 13 + PHP 8.4 + MySQL 8.4 |
| ローカルに必要なもの | conoha-cli のみ（PHP・Composer・Docker不要） |
| デプロイ所要時間 | 約2分（初回ビルド含む） |
| デプロイコマンド | `conoha app init` → `conoha app deploy` |

サンプルコードは [conoha-cli-app-samples](https://github.com/crowdy/conoha-cli-app-samples) リポジトリの `laravel-mysql/` ディレクトリにあります。Laravel以外にも、WordPress、Next.js、Strapi、Supabase、Outlineなど **20以上のサンプル** が収録されています。


### 参考

- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)

