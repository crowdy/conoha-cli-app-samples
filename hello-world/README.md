# hello-world

nginx で静的HTMLを配信する最もシンプルなサンプルです。初めて `conoha app deploy` を試す方におすすめです。

## 構成

- nginx (Alpine)
- ポート: 80 (proxy 経由で HTTPS 終端)

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える
#    例: hello.example.com -> あなたのドメイン

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. デプロイ
conoha app deploy myserver
```

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスすると「Hello from ConoHa!」と表示されます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## カスタマイズ

`index.html` を編集して再度 `conoha app deploy` するだけで更新できます。blue/green 切替で無停止デプロイされ、直前のスロットがまだ落ちきっていなければ `conoha app rollback` で即座に戻せます。
