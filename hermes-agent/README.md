# hermes-agent

Nous Research の自己学習型 AI エージェント「Hermes Agent」を ConoHa VPS にデプロイするサンプルです。ConoHa インフラ管理に特化した DevOps アシスタントとして動作します。

## 構成

| サービス | ポート | 説明 |
|----------|--------|------|
| Gateway | 8642 | エージェントエンジン + OpenAI 互換 API |
| Nginx | 80 | リバースプロキシ（Basic 認証付き） |
| Dashboard | (内部) | Web 管理画面 |

## 前提条件

- [conoha-cli](https://github.com/because-and/conoha-cli) がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- Anthropic API キー（[console.anthropic.com](https://console.anthropic.com/) で取得）

## デプロイ

### Step 1: サーバー作成

```bash
conoha server create --name hermes --flavor g2l-t-4 --image ubuntu-24.04 --key mykey
```

### Step 2: API キー設定

`.env.server` に Anthropic API キーと API サーバーキーを設定してください。

```bash
# .env.server を編集
ANTHROPIC_API_KEY=sk-ant-xxxxx
API_SERVER_KEY=your-secret-key
```

`API_SERVER_KEY` は Gateway API のアクセス制御に使用されます。任意の文字列を設定してください。

### Step 3: アプリ初期化・デプロイ

```bash
conoha app init hermes --app-name hermes-agent \
  --identity ~/.ssh/conoha_mykey --no-input

conoha app deploy hermes --app-name hermes-agent \
  --identity ~/.ssh/conoha_mykey --no-input
```

## 動作確認

### Dashboard

ブラウザで `http://<サーバーIP>/` にアクセスすると Basic 認証のダイアログが表示されます。デフォルトのユーザー名/パスワードは `admin` / `admin` です。

### API ヘルスチェック

```bash
curl http://<サーバーIP>:8642/health
```

## カスタマイズ

### Basic 認証のパスワード変更

デプロイ前に `config/.htpasswd` を更新してください。

```bash
# htpasswd コマンドが使える場合
htpasswd -c config/.htpasswd admin

# openssl で生成する場合
echo "admin:$(openssl passwd -apr1 'your-password')" > config/.htpasswd
```

変更後は再デプロイしてください。

### ペルソナの変更

`config/SOUL.md` を編集してエージェントの性格や専門分野を変更できます。変更後は再デプロイしてください。

### モデルの変更

`config/config.yaml` の `model` セクションを編集してください。

```yaml
model:
  provider: anthropic
  model: claude-opus-4-6     # より高性能なモデルに変更
  api_key_env: ANTHROPIC_API_KEY
  context_window: 200000
```

OpenRouter 経由で他のモデルを使用することも可能です。

```yaml
model:
  provider: openrouter
  model: google/gemini-2.5-pro
  api_key_env: OPENROUTER_API_KEY
  context_window: 1000000
```

## 関連リンク

- [Hermes Agent GitHub](https://github.com/NousResearch/hermes-agent)
- [Hermes Agent Docs](https://hermes-agent.nousresearch.com/)
- [Anthropic Console](https://console.anthropic.com/) - API キー取得
- [ConoHa VPS3](https://www.conoha.jp/vps/)
