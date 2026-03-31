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

## デプロイ

```bash
# サーバー作成（4GB以上推奨、LLM 用にメモリが必要）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name ollama-webui

# デプロイ
conoha app deploy myserver --app-name ollama-webui
```

初回起動時に tinyllama モデル（約600MB）が自動ダウンロードされます。完了まで数分かかります。

## 動作確認

ブラウザで `http://<サーバーIP>:3000` にアクセスすると ChatGPT 風のチャット画面が表示されます。

## カスタマイズ

- Open WebUI の管理画面から追加モデルをダウンロード可能
- より大きなモデル（例: `llama3.2`, `gemma3`）を使う場合はメモリの多いフレーバーを選択
- `compose.yml` の `ollama pull tinyllama` を別のモデルに変更
- GPU 対応サーバーでは `deploy.resources.reservations.devices` で GPU を割り当て可能
- 認証を有効にする場合は `WEBUI_AUTH=true` に変更
