# hermes-agent

Nous Research の自己学習型 AI エージェント「Hermes Agent」を ConoHa VPS にデプロイするサンプルです。ConoHa インフラ管理に特化した DevOps アシスタントとして動作します。

## 構成

| サービス | proxy 公開? | 説明 |
|----------|------------|------|
| nginx | はい (port 80) | リバースプロキシ（Basic 認証付き） — **proxy front** |
| gateway | いいえ (内部 8642) | エージェントエンジン + OpenAI 互換 API（accessory） |
| dashboard | いいえ (内部 9119) | Web 管理画面（accessory） |

> **note**: nginx が conoha-proxy 公開対象の `web` サービスで、gateway と dashboard
> は accessory です。**blue/green スワップは nginx だけが対象** — gateway や
> dashboard を再ビルドしたい場合は `docker compose -p hermes-agent-<slot> build`
> を直接叩くか、それぞれ独立した `conoha.yml` プロジェクトに切り出してください。

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- Anthropic API キー（[console.anthropic.com](https://console.anthropic.com/) で取得）
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

### Step 1: サーバー作成

```bash
conoha server create --name hermes --flavor g2l-t-4 --image ubuntu-24.04 --key mykey
```

### Step 2: Basic 認証の準備

`config/.htpasswd` のデフォルトは `admin` / `admin` で、**compose にマウントされて
公開リポジトリにも見えています**。本番デプロイ前に必ず変更してください:

```bash
# htpasswd コマンドが使える場合
htpasswd -c config/.htpasswd admin

# openssl で生成する場合
echo "admin:$(openssl passwd -apr1 'your-strong-password')" > config/.htpasswd
```

### Step 3: conoha.yml と proxy 起動

```bash
# conoha.yml の `hosts:` を自分の FQDN に書き換える
# DNS A レコードがサーバー IP を指している必要があります

# proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com hermes \
  --identity ~/.ssh/conoha_mykey
```

### Step 4: API キー設定

```bash
conoha app init hermes --identity ~/.ssh/conoha_mykey --no-input

conoha app env set hermes \
  ANTHROPIC_API_KEY=sk-ant-xxxxx \
  API_SERVER_KEY=$(openssl rand -hex 32)
```

`API_SERVER_KEY` は Gateway API のアクセス制御に使用されます — 必ずランダム生成してください。

### Step 5: デプロイ

```bash
conoha app deploy hermes --identity ~/.ssh/conoha_mykey --no-input
```

## 動作確認

### Dashboard

ブラウザで `https://<あなたの FQDN>/` にアクセスすると Basic 認証のダイアログが表示されます。Step 2 で設定したユーザー名/パスワードを入力してください。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

### API ヘルスチェック（コンテナ内部から）

Gateway API のポート 8642 は conoha-proxy 公開対象ではありません。確認するには
サーバーに SSH ログインしたあと `docker exec` で gateway コンテナに入ってください:

```bash
ssh root@<サーバー IP>
docker exec $(docker ps -q -f name=gateway) curl -s http://localhost:8642/health
```

または、外部から OpenAI 互換 API を呼びたい場合は nginx 側で `/v1/*` を
gateway:8642 にプロキシする location を追加してください（デフォルトの `nginx.conf`
は dashboard だけをフロントしています）。

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
