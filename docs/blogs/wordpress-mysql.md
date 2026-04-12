---
title: conoha-cliでWordPress + MySQLをConoHa VPSにワンコマンドデプロイ
tags: Docker Conoha WordPress MySQL conoha-cli
author: crowdy
slide: false
---
## はじめに

WordPressを自前のVPSで動かしたいけど、サーバーの初期設定やDocker環境の構築が面倒——そんなことはありません。

この記事では、WordPress + MySQL の構成を ConoHa VPS3 上に `conoha app deploy` ワンコマンドでデプロイする方法を紹介します。Dockerfileは不要、`compose.yml` だけで完結します。公式イメージをそのまま使うため、ハマりポイントもゼロでした。

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

---

## ファイル構成

```
wordpress-mysql/
├── compose.yml
└── README.md
```

たったこれだけです。Dockerfileも `.dockerignore` も不要。WordPress と MySQL はどちらも公式Dockerイメージが提供されているので、`compose.yml` にイメージ名を書くだけで動きます。

---

## compose.yml

```yaml
services:
  wordpress:
    image: wordpress:latest
    ports:
      - "80:80"
    environment:
      - WORDPRESS_DB_HOST=db
      - WORDPRESS_DB_USER=wordpress
      - WORDPRESS_DB_PASSWORD=${MYSQL_PASSWORD:-wordpress}
      - WORDPRESS_DB_NAME=wordpress
    volumes:
      - wp_data:/var/www/html
    depends_on:
      db:
        condition: service_healthy

  db:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD:-rootpassword}
      - MYSQL_DATABASE=wordpress
      - MYSQL_USER=wordpress
      - MYSQL_PASSWORD=${MYSQL_PASSWORD:-wordpress}
    volumes:
      - db_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  wp_data:
  db_data:
```

ポイント:

- **healthcheck**: MySQLがReadyになるまでWordPressの起動を待機する。`depends_on` + `condition: service_healthy` の組み合わせで起動順序を制御
- **環境変数**: `${VAR:-default}` パターンで、`conoha app env set` での上書きに対応
- **Named Volume**: `wp_data` と `db_data` でデータを永続化。再デプロイしてもデータが消えない

---

## デプロイ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/wordpress-mysql
```

### 2. サーバー作成

```bash
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
```

すでにサーバーがある場合はスキップしてください。

### 3. アプリ初期化

```bash
conoha app init myserver --app-name wordpress
```

```
Initializing app "wordpress" on vm-18268c66-ae (133.88.116.147)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
Initialized empty Git repository in /opt/conoha/wordpress.git/
==> Installing post-receive hook...
==> Done!

App "wordpress" initialized on vm-18268c66-ae (133.88.116.147).
```

### 4. 環境変数の設定

```bash
conoha app env set myserver --app-name wordpress \
  MYSQL_ROOT_PASSWORD=$(openssl rand -base64 18) \
  MYSQL_PASSWORD=$(openssl rand -base64 18)
```

```
Set MYSQL_PASSWORD
Set MYSQL_ROOT_PASSWORD
```

本番環境では必ずデフォルトパスワードを変更してください。`openssl rand` で安全なランダムパスワードを生成しています。

### 5. デプロイ

```bash
conoha app deploy myserver --app-name wordpress
```

```
Archiving current directory...
Uploading to vm-18268c66-ae (133.88.116.147)...
Building and starting containers...
 Image mysql:8.0 Pulling
 Image wordpress:latest Pulling
 ...（各レイヤーのダウンロード進捗）...
 Container wordpress-db-1 Created
 Container wordpress-wordpress-1 Created
 Container wordpress-db-1 Started
 Container wordpress-db-1 Waiting
 Container wordpress-db-1 Healthy
 Container wordpress-wordpress-1 Started
NAME                    IMAGE              STATUS
wordpress-db-1          mysql:8.0          Up 17 seconds (healthy)
wordpress-wordpress-1   wordpress:latest   Up 1 second
Deploy complete.
```

healthcheckにより、MySQLが完全にReadyになるまでWordPressの起動を待機していることが「Waiting → Healthy」の遷移から確認できます。

---

## 動作確認

### コンテナ状態

```bash
conoha app status myserver --app-name wordpress
```

```
NAME                    IMAGE              STATUS                    PORTS
wordpress-db-1          mysql:8.0          Up 35 seconds (healthy)   3306/tcp, 33060/tcp
wordpress-wordpress-1   wordpress:latest   Up 16 seconds             0.0.0.0:80->80/tcp
```

### Webアクセス

ブラウザで `http://<サーバーIP>` にアクセスすると、WordPressの初期セットアップ画面が表示されます。言語選択 → サイト情報入力 → 管理者アカウント作成の3ステップで、すぐにブログを始められます。

---

## 1GBメモリVMで運用できるのか

今回デプロイしたサーバーは **g2l-t-c2m1（2 vCPU / 1GB RAM）** です。「1GBでWordPressは動くの？」と思うかもしれませんが、結論から言えば **1,000ページ以下の個人ブログや小規模サイトなら問題ありません**。

WordPressの公式イメージはApache + mod_phpで構成されており、MySQL 8.0と合わせてもアイドル時のメモリ消費は約500〜600MB程度です。同時アクセスが集中しなければ、1GBのVMでも十分に運用できます。

もしアクセス増加でレスポンスが悪化した場合は：

- **WP Super Cache** や **W3 Total Cache** プラグインでページキャッシュを有効化
- フレーバーを **g2l-t-c3m2（3 vCPU / 2GB）** にスケールアップ

で対応できます。

---

## ハマりポイント：なし

前回の [Strapi記事](https://qiita.com/crowdy/items/ee2f911a3798078cc62b) では、公式Dockerイメージの不在や対話プロンプトの問題でかなり苦戦しました。

しかしWordPress + MySQLの組み合わせは、どちらも公式のDockerイメージが長年メンテナンスされており、`compose.yml` を書くだけで何の問題もなく動きます。Dockerfileを書く必要もなく、ビルド時間もゼロ。イメージのpullだけで完了です。

**かかった時間**: `app init` から `app deploy` 完了まで約2分（イメージのpull時間を含む）。悩む時間はゼロでした。

---

## まとめ

WordPress + MySQLのデプロイは、conoha-cliのサンプルの中でも最もシンプルな部類です。Dockerfileなし、設定ファイルなし、`compose.yml` 1ファイルだけ。`conoha app deploy` ワンコマンドで、数分後にはWordPressのセットアップ画面が表示されます。

個人ブログや小規模サイトなら1GB VMで十分運用できるので、「まずはVPSでWordPressを動かしてみたい」という方の最初の一歩に最適です。

サンプルコードはすべて以下のリポジトリで公開しています。

- サンプル: [crowdy/conoha-cli-app-samples/wordpress-mysql](https://github.com/crowdy/conoha-cli-app-samples/tree/main/wordpress-mysql)
- CLI: [crowdy/conoha-cli](https://github.com/crowdy/conoha-cli)

他にもStrapi、Quickwit + OpenTelemetry、Gitea、Ollama、OAuth2サーバーなど20種類以上のサンプルが揃っていますので、ぜひ試してみてください。

