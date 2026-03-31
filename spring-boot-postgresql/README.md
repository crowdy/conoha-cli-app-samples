# spring-boot-postgresql

Spring Boot と PostgreSQL を使ったシンプルな投稿アプリです。JPA による CRUD 機能を持ちます。

## 構成

- Java 21 + Spring Boot 3.4
- PostgreSQL 17
- ポート: 8080

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name spring-app

# デプロイ
conoha app deploy myserver --app-name spring-app
```

初回ビルドは Maven 依存関係のダウンロードに数分かかります。

## 動作確認

ブラウザで `http://<サーバーIP>:8080` にアクセスすると投稿一覧ページが表示されます。

## カスタマイズ

- `src/main/java/com/example/app/` にエンティティやコントローラーを追加
- `src/main/resources/templates/` に Thymeleaf テンプレートを追加
- 本番環境では `DB_PASSWORD` を `.env.server` で管理
