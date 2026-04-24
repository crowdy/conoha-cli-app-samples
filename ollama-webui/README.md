# ollama-webui

Ollama と Open WebUI を使ったローカル LLM チャット環境です。ブラウザから ChatGPT のような UI で LLM と会話できます。

## 構成

- Ollama（LLM サーバー）
- Open WebUI（チャット UI）
- ポート: 3000

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成（4GB以上推奨、LLM 用にメモリが必要）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. デプロイ
conoha app deploy myserver
```

初回起動時に tinyllama モデル（約600MB）が自動ダウンロードされます。完了まで数分かかります。

> **Note:** モデルのダウンロードは `ollama serve` の起動と並行してバックグラウンドで進行します。WebUI は起動直後からアクセス可能ですが、tinyllama のダウンロードが完了するまでは画面のモデル選択ドロップダウンが空の状態になります。VPS のネットワーク速度にもよりますが、初回は数分お待ちください。進捗は `conoha app logs myserver` で確認できます。`ollama` は accessory として宣言されているため、webui 側のコード変更で deploy し直してもモデルは保持されます。

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスすると ChatGPT 風のチャット画面が表示されます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## カスタマイズ

- Open WebUI の管理画面から追加モデルをダウンロード可能
- より大きなモデル（例: `llama3.2`, `gemma3`）を使う場合はメモリの多いフレーバーを選択
- `compose.yml` の `ollama pull tinyllama` を別のモデルに変更
- GPU 対応サーバーでは `deploy.resources.reservations.devices` で GPU を割り当て可能
- 認証を有効にする場合は `WEBUI_AUTH=true` に変更
