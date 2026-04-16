---
title: conoha-cliでHermes Agent（自己学習型AIエージェント）をConoHa VPSにデプロイ — SPAとBasic認証の罠も添えて
tags: ConoHa conoha-cli HermesAgent AI Docker
author: crowdy
slide: false
---
## はじめに

「自分専用のAIエージェントを自分のサーバーに立てたい」——Claude Code や ChatGPT のようなエージェントを、SaaS ではなく **自分のインフラで動かしたい** という需要は増えています。データの外部送信を避けたい、カスタムペルソナを持たせたい、API キーの管理を自分でやりたい、といった理由です。

今回は、Nous Research が開発する自己学習型 AI エージェント **[Hermes Agent](https://github.com/NousResearch/hermes-agent)**（GitHub 90,000+ スター）を ConoHa VPS3 にデプロイしてみました。デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使い、ターミナルから `conoha app deploy` ひとつで完結する構成にしています。

この記事では、デプロイ手順に加えて、**実際にデプロイしてみてハマった 4 つのポイント** を共有します。特に「nginx の Basic 認証と SPA の fetch() が噛み合わない問題」は、Hermes Agent に限らずあらゆる SPA + リバースプロキシ構成で踏む可能性があるので、参考になるかもしれません。

---

## Hermes Agent とは

[Hermes Agent](https://github.com/NousResearch/hermes-agent) は、Nous Research が開発するオープンソースの AI エージェントフレームワークです。

| 特徴 | 説明 |
|------|------|
| **自己学習** | タスク経験からスキルドキュメントを自動生成し、次回以降に再利用 |
| **クロスセッション記憶** | FTS5 + LLM 要約による永続メモリ |
| **40+ 組み込みツール** | ファイル操作、Web 検索、ブラウザ自動化（Playwright）など |
| **モデル非依存** | Anthropic / OpenRouter / Ollama など 200+ モデルに対応 |
| **メッセージング連携** | Telegram / Discord / Slack / WhatsApp / Email |
| **OpenAI 互換 API** | Gateway が OpenAI API 互換エンドポイントを公開 |

2026年2月のリリースから2ヶ月で GitHub スター 90,000 超を獲得しており、競合フレームワークのセキュリティ問題（2026年3月）をきっかけに急速に普及しました。

---

## 使用するスタック

| コンポーネント | 役割 |
|---|---|
| **Hermes Agent** | AI エージェントエンジン（Docker イメージ） |
| **Claude Sonnet 4.6** | デフォルト LLM（Anthropic API 経由） |
| **nginx** | リバースプロキシ + Basic 認証 |
| **ConoHa VPS3** | 4GB RAM インスタンス |
| **conoha-cli** | ターミナルから VPS 操作する CLI |

### アーキテクチャ

```
ブラウザ
  ↓ Basic認証
nginx (:80)
  ↓ proxy_pass
Dashboard (:9119, 内部)  ←→  Gateway (:8642)
                                ↓
                          Anthropic API
                          (claude-sonnet-4-6)
```

Gateway が AI エージェントの本体で、OpenAI 互換 API を公開します。Dashboard は Web 管理画面です。nginx は Dashboard の前段で Basic 認証を提供します。

GPU は **不要** です。Hermes Agent 自体は軽量で、LLM の推論は外部 API（今回は Anthropic）に委任するためです。

---

## conoha-cli とは

[conoha-cli](https://github.com/crowdy/conoha-cli) は、ConoHa VPS3 をターミナルから操作するための CLI ツールです。

### 主な機能

- **サーバー管理**: VPS の作成・削除・一覧表示
- **app deploy**: `compose.yml` があるディレクトリを VPS にデプロイ
- **app logs**: コンテナログのリアルタイム表示
- **app status**: コンテナの稼働状態確認

---

## デプロイ手順

### Step 1: サーバーの作成

```bash
conoha server create \
  --name hermes \
  --flavor g2l-t-c4m4 \
  --image vmi-docker-29.2-ubuntu-24.04-amd64 \
  --key-name my-key \
  --security-group default \
  --security-group IPv4v6-SSH \
  --security-group IPv4v6-Web \
  --security-group 3000-9999 \
  --yes --wait
```

Docker プリインストール済みのイメージ（`vmi-docker`）を使うと、`app init` 時の Docker インストールがスキップされて少し速くなります。セキュリティグループ `3000-9999` は Gateway API（ポート 8642）用です。

### Step 2: API キーの設定

`.env.server` に Anthropic API キーと API サーバーキーを設定します。

```bash
# .env.server
ANTHROPIC_API_KEY=sk-ant-xxxxx
API_SERVER_KEY=your-secret-key
```

`API_SERVER_KEY` は Gateway の OpenAI 互換 API エンドポイントのアクセス制御に使用されます。

### Step 3: アプリ初期化・デプロイ

```bash
cd conoha-cli-app-samples/hermes-agent

conoha app init hermes --app-name hermes-agent
conoha app deploy hermes --app-name hermes-agent
```

`compose.yml` はこのようになっています。

```yaml
services:
  gateway:
    image: nousresearch/hermes-agent
    command: gateway run
    restart: unless-stopped
    mem_limit: 4g
    cpus: 2
    shm_size: 1g
    ports:
      - "8642:8642"
    volumes:
      - hermes_data:/opt/data
      - ./config/config.yaml:/opt/data/config.yaml
      - ./config/SOUL.md:/opt/data/SOUL.md:ro
    env_file:
      - .env.server
    environment:
      - API_SERVER_ENABLED=true
      - API_SERVER_HOST=0.0.0.0
      - GATEWAY_ALLOW_ALL_USERS=true
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8642/health')"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 60s

  dashboard:
    image: nousresearch/hermes-agent
    command: dashboard --host 0.0.0.0 --insecure --no-open
    restart: unless-stopped
    expose:
      - "9119"
    volumes:
      - hermes_data:/opt/data
    environment:
      - GATEWAY_HEALTH_URL=http://gateway:8642
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:9119/')"]
      interval: 30s
      timeout: 5s
      retries: 3
    depends_on:
      gateway:
        condition: service_healthy

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./config/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./config/.htpasswd:/etc/nginx/.htpasswd:ro
    depends_on:
      dashboard:
        condition: service_healthy

volumes:
  hermes_data:
```

### Step 4: 動作確認

```bash
# Gateway ヘルスチェック
curl http://<サーバーIP>:8642/health
# → {"status": "ok", "platform": "hermes-agent"}

# Dashboard（Basic 認証付き）
curl -u admin:password http://<サーバーIP>/
# → HTTP 200
```

ブラウザで `http://<サーバーIP>/` にアクセスすると Basic 認証ダイアログが表示され、ログイン後に Dashboard の管理画面が開きます。

---

## カスタムペルソナ: ConoHa インフラアシスタント

今回のサンプルでは、Hermes Agent のペルソナ機能（`SOUL.md`）を使って **ConoHa インフラ管理に特化した DevOps アシスタント** を設定しています。

```markdown
# ConoHa Infrastructure Assistant

あなたはConoHa VPSのインフラ管理を支援するDevOpsアシスタントです。

## 専門分野
- Linux (Ubuntu) サーバー管理
- Docker コンテナオーケストレーション
- Nginx リバースプロキシ設定
- SSL/TLS 証明書管理 (Let's Encrypt)
- ファイアウォール・セキュリティ設定 (ufw, iptables)
- ログ分析・パフォーマンス監視
```

`SOUL.md` を書き換えるだけでペルソナを自由に変更できます。プログラミングアシスタント、文書レビュアー、データ分析エージェントなど、用途に応じてカスタマイズ可能です。

---

## ハマりポイント

ここからが本題です。`compose.yml` をさっと書いて `conoha app deploy` すれば終わり……と思いきや、実際にデプロイしてみると **4 つの問題** が発生しました。

### 1. Gateway の API サーバーが起動しない

**症状**: Gateway コンテナは起動するが、ヘルスチェック（ポート 8642）が通らない。

```
WARNING gateway.run: No messaging platforms enabled.
```

**原因**: `gateway run` コマンドは Telegram / Discord 等のメッセージング連携を起動するもので、**OpenAI 互換 API サーバーはデフォルトで無効** です。

**解決策**: 環境変数で API サーバーを明示的に有効化する。

```yaml
environment:
  - API_SERVER_ENABLED=true
  - API_SERVER_HOST=0.0.0.0    # コンテナ外からアクセス可能に
  - GATEWAY_ALLOW_ALL_USERS=true
```

ドキュメントには `gateway run` すれば API が立ち上がるように書かれていますが、実際には `API_SERVER_ENABLED=true` が必要でした。`API_SERVER_HOST` もデフォルトは `127.0.0.1` なので、Docker のポートマッピングを通すには `0.0.0.0` への変更が必須です。

### 2. ヘルスチェックの `curl` がコンテナに存在しない

**症状**: ヘルスチェックが常に失敗する。

```
exec: "curl": executable file not found in $PATH
```

**原因**: `nousresearch/hermes-agent` イメージは Debian ベースですが、`curl` が入っていません。

**解決策**: `python3`（イメージに同梱）で代替する。

```yaml
healthcheck:
  test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8642/health')"]
```

Docker のヘルスチェックではよく `curl -f` が使われますが、最近の軽量イメージでは curl が入っていないことが増えています。`python3` や `wget` で代替するパターンは覚えておくと便利です。

### 3. Dashboard が localhost にバインドされる

**症状**: Dashboard コンテナは起動するが、外部からポート 80 でアクセスできない。

```
Hermes Web UI → http://127.0.0.1:9119
```

**原因**: `hermes dashboard` コマンドのデフォルトバインドが `127.0.0.1`。Docker のポートマッピング（`-p 80:9119`）はホスト→コンテナのマッピングであり、コンテナ内でアプリが `127.0.0.1` にバインドしていると外部からは到達できません。

**解決策**: `--host 0.0.0.0 --insecure --no-open` フラグを追加する。

```yaml
command: dashboard --host 0.0.0.0 --insecure --no-open
```

`--insecure` は「DANGEROUS: exposes API keys on the network」と警告が出ますが、前段に nginx + Basic 認証を置くため問題ありません。

### 4. SPA の fetch() と Basic 認証が噛み合わない（最大のハマり）

**症状**: ブラウザで Basic 認証に成功してページは表示されるが、直後に再び認証ダイアログが表示され、何度入力してもループする。

**原因**: これは Hermes Agent 固有の問題ではなく、**SPA（Single Page Application）+ nginx Basic 認証** の構造的な問題です。

仕組みはこうです。

1. ブラウザが `GET /` をリクエスト → nginx が `401` を返す → ブラウザが認証ダイアログを表示
2. ユーザーがパスワードを入力 → ブラウザが `Authorization: Basic ...` ヘッダ付きで再リクエスト → `200` で HTML を取得
3. SPA の JavaScript が `fetch('/api/status')` を呼ぶ → **`Authorization` ヘッダが付かない** → `401`
4. ブラウザが `401` + `WWW-Authenticate: Basic` を受け取り → 認証ダイアログを再表示 → **ループ**

ポイントは **ステップ 3** です。ブラウザの `fetch()` API は、Basic 認証のクレデンシャルを **自動で送信しません**。`credentials: 'same-origin'` はクッキーを送りますが、Basic 認証ヘッダは送りません。

**解決策**: Cookie ベースのセッション認証に変換する。

```nginx
map $cookie_hermes_auth $auth_bypass {
    "authenticated" "off";
    default         "Hermes Agent";
}

server {
    listen 80;

    # HTML/静的アセット — Basic 認証を要求し、Cookie をセット
    location / {
        auth_basic "Hermes Agent";
        auth_basic_user_file /etc/nginx/.htpasswd;
        add_header Set-Cookie "hermes_auth=authenticated; Path=/; HttpOnly; SameSite=Strict" always;
        proxy_pass http://dashboard:9119;
    }

    # API パス — Cookie があれば認証バイパス、なければ Basic 認証
    location /api/ {
        auth_basic $auth_bypass;
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://dashboard:9119;
    }
}
```

フローはこうなります。

1. 初回アクセス `/` → Basic 認証 → 成功 → `Set-Cookie: hermes_auth=authenticated`
2. SPA の `fetch('/api/status')` → Cookie が自動送信 → `$auth_bypass` が `"off"` に → 認証スキップ → `200`
3. Cookie なしで `/api/` に直接アクセス → Basic 認証を要求 → 保護される

`auth_basic` ディレクティブの値に **変数を使える** のがポイントです。Cookie の有無で `"off"`（認証無効）と `"Hermes Agent"`（realm名 = 認証有効）を動的に切り替えています。

---

## まとめ

| 項目 | 内容 |
|------|---|
| デプロイ対象 | Hermes Agent v0.9.0（自己学習型 AI エージェント） |
| 構成 | Gateway + Dashboard + nginx（3 サービス） |
| LLM | Anthropic Claude Sonnet 4.6（外部 API） |
| 推奨フレーバー | `g2l-t-c4m4`（4vCPU, 4GB RAM） |
| GPU | 不要 |
| 認証 | nginx Basic 認証 + Cookie セッション |
| サンプル | [crowdy/conoha-cli-app-samples/hermes-agent](https://github.com/crowdy/conoha-cli-app-samples/tree/feat/hermes-agent/hermes-agent) |

- **Hermes Agent** を ConoHa VPS3 に `conoha app deploy` でデプロイし、Gateway API と Dashboard の動作を確認しました
- デプロイ自体は簡単ですが、**API サーバーの明示的有効化**、**curl 不在の healthcheck 対応**、**Dashboard の localhost バインド**、**SPA と Basic 認証の不整合** という 4 つのハマりポイントがありました
- 特に「SPA の fetch() が Basic 認証ヘッダを送らない」問題は、nginx の `map` + Cookie で解決するパターンとして汎用的に使えます
- `SOUL.md` でペルソナをカスタマイズできるため、用途に応じた専門エージェントを自分のサーバーに立てられます

サンプルコードは [crowdy/conoha-cli-app-samples](https://github.com/crowdy/conoha-cli-app-samples/tree/feat/hermes-agent/hermes-agent) にあります。

---

### 参考

- [Hermes Agent GitHub](https://github.com/NousResearch/hermes-agent)
- [Hermes Agent Docs](https://hermes-agent.nousresearch.com/)
- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)
