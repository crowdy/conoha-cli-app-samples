---
title: conoha-cliでSendGrid招待メールアプリをConoHa VPSにデプロイ — Next.js + FastAPI + nginx Basic認証の3コンテナ構成
tags: ConoHa conoha-cli SendGrid NextJS FastAPI nginx Docker
author: crowdy
slide: false
---
## はじめに

「チームメンバーに招待メールを送りたいけど、SaaS のメール配信サービスの管理画面まではいらない」——そんなことはありませんか？

メール配信の仕組み自体は SendGrid API を叩くだけで済むのですが、フロントエンドの UI、バックエンドの API、そしてアクセス制御を組み合わせると、意外と構成が複雑になりがちです。

今回は、**Next.js（フロントエンド）+ FastAPI（バックエンド）+ nginx（Basic 認証付きリバースプロキシ）** の 3 コンテナ構成で、組織の管理者がメンバー候補に招待メールを送れるシンプルな Web アプリを作り、[conoha-cli](https://github.com/crowdy/conoha-cli) で ConoHa VPS3 にデプロイしてみました。

この記事では、構成の解説とデプロイ手順に加えて、**実際にデプロイして遭遇した 3 つのハマりポイント** を共有します。

---

## 使用するスタック

| コンポーネント | 役割 |
|---|---|
| **Next.js 15** | 招待フォーム UI（React 19） |
| **FastAPI** | SendGrid API を呼び出すバックエンド |
| **SendGrid** | メール送信（API 経由、プレーンテキスト） |
| **nginx** | リバースプロキシ + Basic 認証 |
| **ConoHa VPS3** | 1GB RAM インスタンス |
| **conoha-cli** | ターミナルから VPS 操作する CLI |

### アーキテクチャ

```
ブラウザ
  ↓ Basic認証
nginx (:80)
  ├─ /api/*  → FastAPI (:8000, 内部)
  │              ↓
  │          SendGrid API
  └─ /*     → Next.js (:3000, 内部)
```

nginx がすべてのリクエストに Basic 認証を適用し、パスに応じて FastAPI または Next.js にルーティングします。外部に公開するのはポート 80 のみです。

---

## プロジェクト構成

```
sendgrid-invitation/
├── compose.yml                # 3サービスの Docker Compose
├── .env.server                # SendGrid APIキー等（デプロイ時にサーバーへ転送）
├── nginx/
│   ├── nginx.conf             # リバースプロキシ + Basic認証
│   └── .htpasswd              # 認証ファイル
├── frontend/
│   ├── Dockerfile             # マルチステージビルド
│   ├── package.json
│   ├── next.config.ts         # standalone出力
│   └── app/
│       ├── layout.tsx         # ルートレイアウト
│       ├── page.tsx           # 招待フォーム（1ページのみ）
│       └── globals.css        # スタイル
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py            # FastAPI（/api/health, /api/invite）
│       └── config.py          # Pydantic BaseSettings
└── README.md
```

---

## 主要コードの解説

### FastAPI バックエンド（`backend/app/main.py`）

招待メール送信の API エンドポイントです。

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

from app.config import settings

app = FastAPI()


class InviteRequest(BaseModel):
    to_email: EmailStr
    to_name: str = ""
    message: str = ""


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/invite")
def invite(req: InviteRequest):
    to_name = req.to_name or req.to_email
    body = (
        f"{settings.from_name} からの招待\n"
        f"\n"
        f"{to_name} 様\n"
        f"\n"
        f"{settings.from_name} があなたをメンバーとして招待しています。\n"
    )
    if req.message:
        body += f"\n{req.message}\n"
    body += f"\n---\nこのメールは {settings.from_name} から送信されました。\n"

    message = Mail(
        from_email=(settings.from_email, settings.from_name),
        to_emails=req.to_email,
        subject=f"{settings.from_name} からの招待",
        plain_text_content=body,
    )

    try:
        sg = SendGridAPIClient(settings.sendgrid_api_key)
        response = sg.send(message)
        if not (200 <= response.status_code < 300):
            raise HTTPException(status_code=502, detail="Failed to send email")
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=502, detail=str(e))

    return {"success": True}
```

ポイント：

- `EmailStr` で宛先メールアドレスのバリデーション（不正な形式は `422` で拒否）
- `settings` は Pydantic の `BaseSettings` で環境変数から自動読み込み
- SendGrid SDK の例外は `HTTPException(502)` にラップして、フロントエンドに分かりやすいエラーを返す

### 環境変数の管理（`backend/app/config.py`）

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    sendgrid_api_key: str = ""
    from_email: str = ""
    from_name: str = ""


settings = Settings()
```

`conoha app deploy` は `.env.server` をサーバー側の `.env` にコピーするため、Pydantic の `BaseSettings` で自動読み込みされます。

### Next.js フロントエンド（`frontend/app/page.tsx`）

1 ページのみのシンプルなフォームです。

```tsx
"use client";

import { useState, FormEvent } from "react";

export default function Home() {
  const [toEmail, setToEmail] = useState("");
  const [toName, setToName] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage("");

    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_email: toEmail,
          to_name: toName,
          message,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "送信に失敗しました");
      }

      setStatus("success");
      setToEmail("");
      setToName("");
      setMessage("");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "送信に失敗しました");
    }
  }

  // ... JSX（フォーム描画）
}
```

`fetch("/api/invite")` はブラウザの同一オリジンリクエストなので、nginx を経由して FastAPI に到達します。

### nginx 設定（`nginx/nginx.conf`）

```nginx
events {
    worker_connections 1024;
}

http {
    server {
        listen 80;

        auth_basic "Admin Area";
        auth_basic_user_file /etc/nginx/.htpasswd;

        location /api/ {
            proxy_pass http://backend:8000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location / {
            proxy_pass http://frontend:3000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

`server` レベルで `auth_basic` を設定しているため、`/api/*` と `/*` の両方に Basic 認証が適用されます。

### Docker Compose（`compose.yml`）

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/.htpasswd:/etc/nginx/.htpasswd:ro
    depends_on:
      frontend:
        condition: service_started
      backend:
        condition: service_healthy

  frontend:
    build: ./frontend
    expose:
      - "3000"

  backend:
    build: ./backend
    expose:
      - "8000"
    env_file:
      - .env.server
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s
```

ポイント：

- `expose` でコンテナ間のみポートを公開（外部には nginx の 80 番ポートのみ）
- `depends_on` + `condition: service_healthy` でバックエンドのヘルスチェック完了を待ってから nginx を起動
- フロントエンドは `service_started` で十分（ヘルスチェックエンドポイントがないため）

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
  --name sendgrid-invitation \
  --flavor g2l-t-c2m1 \
  --image vmi-docker-29.2-ubuntu-24.04-amd64 \
  --key-name tkim-cli-test-key \
  --security-group IPv4v6-SSH \
  --security-group IPv4v6-Web \
  --security-group 3000-9999 \
  --yes --wait
```

Docker プリインストール済みのイメージ（`vmi-docker`）を使うと `app init` 時の Docker インストールがスキップされて少し速くなります。1GB RAM（`g2l-t-c2m1`）で問題なく動作しました。

### Step 2: SendGrid API キーの取得と環境変数の設定

1. [SendGrid](https://sendgrid.com/) でアカウントを作成
2. Settings > API Keys で API キーを作成（Mail Send 権限）
3. Sender Authentication で送信元メールアドレスを認証

```bash
cp .env.server.example .env.server
```

`.env.server` を編集：

```
SENDGRID_API_KEY=SG.your-actual-api-key
FROM_EMAIL=admin@example.com
FROM_NAME=あなたの組織名
```

### Step 3: Basic 認証の設定

```bash
# htpasswd がない場合: apt install apache2-utils
htpasswd -c nginx/.htpasswd admin
```

パスワードを入力してください。

### Step 4: アプリ初期化・デプロイ

```bash
cd conoha-cli-app-samples/sendgrid-invitation

conoha app init sendgrid-invitation --app-name sendgrid-invitation
conoha app deploy sendgrid-invitation --app-name sendgrid-invitation
```

初回デプロイでは Next.js のビルド（マルチステージ Docker ビルド）に 1〜2 分かかります。

### Step 5: 動作確認

```bash
# Basic認証なし → 401
curl -s -o /dev/null -w "%{http_code}" http://<サーバーIP>/
# → 401

# ヘルスチェック
curl -u admin:password http://<サーバーIP>/api/health
# → {"status":"ok"}

# 招待メール送信
curl -u admin:password \
  -X POST http://<サーバーIP>/api/invite \
  -H "Content-Type: application/json" \
  -d '{"to_email":"member@example.com","to_name":"田中太郎","message":"チームに参加してください"}'
# → {"success":true}
```

ブラウザで `http://<サーバーIP>/` にアクセスすると Basic 認証ダイアログが表示され、ログイン後に招待フォームが開きます。

---

## ハマりポイント

### 1. SendGrid の 401 エラーが「画面上は 401」「コンソールは 502」で混乱する

**症状**: 招待メールの送信ボタンを押すと、画面には `HTTP Error 401: Unauthorized` と表示されるが、ブラウザの JavaScript コンソールには `POST /api/invite 502 (Bad Gateway)` と表示される。

**原因**: この「401」は **nginx の Basic 認証ではなく、SendGrid API の認証エラー** です。

リクエストの流れを追うと分かります。

1. `fetch("/api/invite")` → nginx（Basic 認証 OK）→ FastAPI
2. FastAPI が SendGrid API を呼び出す → **API キーが無効** → SendGrid SDK が `HTTP Error 401: Unauthorized` 例外を投げる
3. FastAPI が例外をキャッチし、`HTTPException(status_code=502, detail="HTTP Error 401: Unauthorized")` を返す
4. フロントエンドが `res.json().detail` を画面に表示 → 「HTTP Error 401: Unauthorized」

つまり画面の「401」は SendGrid 側のメッセージで、HTTP ステータスは「502」です。`.env.server` に正しい SendGrid API キーを設定すれば解決します。

**教訓**: エラーメッセージと HTTP ステータスコードが異なるレイヤーから来ることがあります。「401 が出た → Basic 認証の問題？」と短絡せず、ブラウザのネットワークタブで実際のステータスコードを確認しましょう。

### 2. `.htpasswd` のフォーマットに注意

**症状**: nginx が起動するが、正しいパスワードを入力しても認証が通らない。

**原因**: `.htpasswd` は **Apache 互換フォーマット** である必要があります。`htpasswd` コマンドが使えない環境では `openssl` で生成できますが、フォーマットを間違えると認証が失敗します。

```bash
# OK: Apache MD5 フォーマット
openssl passwd -apr1 your-password
# → $apr1$xxxxx$xxxxxxxxxxxxx

# NG: SHA-256 や他のフォーマット
openssl passwd -5 your-password
# nginx が認識しない場合がある
```

**解決策**: `htpasswd -c nginx/.htpasswd admin` を使うか、`openssl passwd -apr1` で生成して `admin:<ハッシュ>` 形式でファイルに書き込む。

### 3. `node_modules` がデプロイアーカイブに含まれると遅い

**症状**: `conoha app deploy` のアーカイブ作成に時間がかかり、アップロードサイズが大きい。

```
Archiving current directory...
Warning: skipping symlink frontend/node_modules/.bin/nanoid
Warning: skipping symlink frontend/node_modules/.bin/next
...
```

**原因**: `conoha app deploy` はカレントディレクトリを `.git/` を除いてアーカイブしますが、`node_modules/` は除外されません。今回のケースでは `npm install` 済みの `node_modules/`（約 450MB）がそのままアップロードされています。

**解決策**: `.dockerignore` をフロントエンドディレクトリに作成する。

```
node_modules/
.next/
```

Docker ビルド時に `node_modules/` をコンテキストに含めないので、ビルドも速くなります。ただし、`conoha app deploy` のアーカイブ自体には引き続き含まれます。将来的には `.conohaignore` のような仕組みがあると便利かもしれません。

---

## まとめ

| 項目 | 内容 |
|------|---|
| デプロイ対象 | SendGrid 招待メールアプリ |
| 構成 | Next.js + FastAPI + nginx（3 サービス） |
| メール送信 | SendGrid API（プレーンテキスト） |
| 認証 | nginx Basic 認証 |
| 推奨フレーバー | `g2l-t-c2m1`（2vCPU, 1GB RAM） |
| サンプル | [crowdy/conoha-cli-app-samples/sendgrid-invitation](https://github.com/crowdy/conoha-cli-app-samples/tree/main/sendgrid-invitation) |

- **Next.js + FastAPI + nginx** の 3 コンテナ構成を `conoha app deploy` ひとつでデプロイしました
- DB 不要、外部認証サービス不要のシンプルな構成で、SendGrid API だけでメール送信を実現しています
- nginx の Basic 認証でサイト全体を保護しつつ、ブラウザの `fetch()` も同一オリジンであれば Basic 認証クレデンシャルが自動送信されるため、SPA 特有の認証問題は発生しません
- SendGrid API キーのエラーが「401」として画面に表示される混乱や、`node_modules` のデプロイサイズなど、実際に踏んだポイントを共有しました

サンプルコードは [crowdy/conoha-cli-app-samples](https://github.com/crowdy/conoha-cli-app-samples/tree/main/sendgrid-invitation) にあります。

---

### 参考

- [SendGrid Docs — Sending Email with the API](https://docs.sendgrid.com/for-developers/sending-email/api-getting-started)
- [FastAPI — Request Body](https://fastapi.tiangolo.com/tutorial/body/)
- [nginx — auth_basic](https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html)
- [crowdy/conoha-cli — GitHub](https://github.com/crowdy/conoha-cli)
