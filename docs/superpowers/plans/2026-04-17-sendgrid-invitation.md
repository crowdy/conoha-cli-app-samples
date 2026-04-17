# SendGrid Invitation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a simple invitation email app with Next.js + FastAPI + nginx Basic Auth, deployable to ConoHa VPS via conoha-cli.

**Architecture:** Three containers behind nginx reverse proxy. nginx handles Basic Auth and routes `/api/*` to FastAPI (port 8000), everything else to Next.js (port 3000). Only port 80 is exposed publicly. FastAPI uses the `sendgrid` Python package to send plain-text invitation emails.

**Tech Stack:** Next.js 15 (React 19), FastAPI, SendGrid Python SDK, nginx:alpine, Docker Compose

---

## File Structure

```
sendgrid-invitation/
├── compose.yml                  # 3-service Docker Compose
├── .env.server.example          # Template for environment variables
├── nginx/
│   └── nginx.conf               # Reverse proxy + Basic Auth config
├── frontend/
│   ├── Dockerfile               # Multi-stage Next.js build
│   ├── package.json             # Next.js + React dependencies
│   ├── next.config.ts           # standalone output
│   ├── tsconfig.json            # TypeScript config
│   └── app/
│       ├── layout.tsx           # Root layout
│       ├── page.tsx             # Invitation form (single page)
│       └── globals.css          # Minimal styles
├── backend/
│   ├── Dockerfile               # Python 3.12 slim
│   ├── requirements.txt         # fastapi, uvicorn, sendgrid, pydantic
│   ├── app/
│   │   ├── main.py              # FastAPI app with /api/invite and /api/health
│   │   └── config.py            # Pydantic BaseSettings for env vars
│   └── tests/
│       └── test_main.py         # API endpoint tests
└── README.md                    # Japanese setup & deploy guide
```

---

### Task 1: FastAPI Backend — Config & Health Check

**Files:**
- Create: `sendgrid-invitation/backend/app/__init__.py`
- Create: `sendgrid-invitation/backend/app/config.py`
- Create: `sendgrid-invitation/backend/app/main.py`
- Create: `sendgrid-invitation/backend/requirements.txt`
- Create: `sendgrid-invitation/backend/tests/__init__.py`
- Create: `sendgrid-invitation/backend/tests/test_main.py`

- [ ] **Step 1: Create requirements.txt**

```
fastapi==0.115.12
uvicorn[standard]==0.34.2
sendgrid==6.11.0
pydantic==2.11.3
pydantic-settings==2.9.1
httpx==0.28.1
pytest==8.3.5
```

- [ ] **Step 2: Create config.py with Pydantic BaseSettings**

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    sendgrid_api_key: str = ""
    from_email: str = ""
    from_name: str = ""


settings = Settings()
```

- [ ] **Step 3: Write the failing test for health endpoint**

Create `sendgrid-invitation/backend/app/__init__.py` (empty file).
Create `sendgrid-invitation/backend/tests/__init__.py` (empty file).

```python
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd sendgrid-invitation/backend && pip install -r requirements.txt && python -m pytest tests/test_main.py::test_health -v`
Expected: FAIL (main.py does not exist)

- [ ] **Step 5: Create main.py with health endpoint**

```python
from fastapi import FastAPI

app = FastAPI()


@app.get("/api/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd sendgrid-invitation/backend && python -m pytest tests/test_main.py::test_health -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add sendgrid-invitation/backend/
git commit -m "feat(sendgrid-invitation): add FastAPI backend with health endpoint"
```

---

### Task 2: FastAPI Backend — Invite Endpoint

**Files:**
- Modify: `sendgrid-invitation/backend/app/main.py`
- Modify: `sendgrid-invitation/backend/tests/test_main.py`

- [ ] **Step 1: Write the failing test for invite endpoint (success case)**

Append to `sendgrid-invitation/backend/tests/test_main.py`:

```python
from unittest.mock import patch, MagicMock


def test_invite_success():
    mock_sg = MagicMock()
    mock_response = MagicMock()
    mock_response.status_code = 202
    mock_sg.send.return_value = mock_response

    with patch("app.main.SendGridAPIClient", return_value=mock_sg):
        with patch("app.main.settings") as mock_settings:
            mock_settings.sendgrid_api_key = "test-key"
            mock_settings.from_email = "admin@example.com"
            mock_settings.from_name = "Test Org"
            response = client.post(
                "/api/invite",
                json={
                    "to_email": "member@example.com",
                    "to_name": "田中太郎",
                    "message": "チームに参加してください",
                },
            )
    assert response.status_code == 200
    assert response.json() == {"success": True}
```

- [ ] **Step 2: Write the failing test for invite endpoint (validation error)**

Append to `sendgrid-invitation/backend/tests/test_main.py`:

```python
def test_invite_invalid_email():
    response = client.post(
        "/api/invite",
        json={
            "to_email": "not-an-email",
            "to_name": "Test",
            "message": "Hello",
        },
    )
    assert response.status_code == 422
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd sendgrid-invitation/backend && python -m pytest tests/test_main.py -v`
Expected: test_invite_success FAIL, test_invite_invalid_email FAIL

- [ ] **Step 4: Implement the invite endpoint in main.py**

Replace `sendgrid-invitation/backend/app/main.py` with:

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
        if response.status_code not in (200, 201, 202):
            raise HTTPException(status_code=502, detail="Failed to send email")
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=502, detail=str(e))

    return {"success": True}
```

Also add `email-validator` to `requirements.txt` (required by Pydantic `EmailStr`):

```
fastapi==0.115.12
uvicorn[standard]==0.34.2
sendgrid==6.11.0
pydantic==2.11.3
pydantic-settings==2.9.1
email-validator==2.2.0
httpx==0.28.1
pytest==8.3.5
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd sendgrid-invitation/backend && pip install -r requirements.txt && python -m pytest tests/test_main.py -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add sendgrid-invitation/backend/
git commit -m "feat(sendgrid-invitation): add /api/invite endpoint with SendGrid"
```

---

### Task 3: FastAPI Backend — Dockerfile

**Files:**
- Create: `sendgrid-invitation/backend/Dockerfile`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Build to verify it works**

Run: `cd sendgrid-invitation && docker build -t sendgrid-invitation-backend ./backend`
Expected: Build completes successfully

- [ ] **Step 3: Commit**

```bash
git add sendgrid-invitation/backend/Dockerfile
git commit -m "feat(sendgrid-invitation): add backend Dockerfile"
```

---

### Task 4: Next.js Frontend

**Files:**
- Create: `sendgrid-invitation/frontend/package.json`
- Create: `sendgrid-invitation/frontend/next.config.ts`
- Create: `sendgrid-invitation/frontend/tsconfig.json`
- Create: `sendgrid-invitation/frontend/app/layout.tsx`
- Create: `sendgrid-invitation/frontend/app/page.tsx`
- Create: `sendgrid-invitation/frontend/app/globals.css`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "sendgrid-invitation-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^15.3.1",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.2",
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Create next.config.ts**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create globals.css**

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  line-height: 1.6;
  color: #333;
  background-color: #f5f5f5;
}

.container {
  max-width: 480px;
  margin: 80px auto;
  padding: 32px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

h1 {
  font-size: 1.5rem;
  margin-bottom: 24px;
  text-align: center;
}

.form-group {
  margin-bottom: 16px;
}

label {
  display: block;
  margin-bottom: 4px;
  font-weight: 600;
  font-size: 0.9rem;
}

input,
textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1rem;
}

textarea {
  resize: vertical;
  min-height: 80px;
}

button[type="submit"] {
  width: 100%;
  padding: 12px;
  background: #0070f3;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
  margin-top: 8px;
}

button[type="submit"]:hover {
  background: #005bb5;
}

button[type="submit"]:disabled {
  background: #999;
  cursor: not-allowed;
}

.message {
  margin-top: 16px;
  padding: 12px;
  border-radius: 4px;
  text-align: center;
}

.message.success {
  background: #e6f9e6;
  color: #1a7a1a;
}

.message.error {
  background: #fde8e8;
  color: #c53030;
}
```

- [ ] **Step 5: Create layout.tsx**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "メンバー招待",
  description: "メンバーに招待メールを送信します",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Create page.tsx (invitation form)**

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

  return (
    <div className="container">
      <h1>メンバー招待</h1>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="to_email">メールアドレス *</label>
          <input
            id="to_email"
            type="email"
            required
            value={toEmail}
            onChange={(e) => setToEmail(e.target.value)}
            placeholder="member@example.com"
          />
        </div>
        <div className="form-group">
          <label htmlFor="to_name">名前</label>
          <input
            id="to_name"
            type="text"
            value={toName}
            onChange={(e) => setToName(e.target.value)}
            placeholder="田中太郎"
          />
        </div>
        <div className="form-group">
          <label htmlFor="message">メッセージ</label>
          <textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="チームに参加してください"
          />
        </div>
        <button type="submit" disabled={status === "sending"}>
          {status === "sending" ? "送信中..." : "招待メールを送信"}
        </button>
      </form>
      {status === "success" && (
        <div className="message success">招待メールを送信しました</div>
      )}
      {status === "error" && (
        <div className="message error">{errorMessage}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add sendgrid-invitation/frontend/
git commit -m "feat(sendgrid-invitation): add Next.js frontend with invitation form"
```

---

### Task 5: Frontend Dockerfile

**Files:**
- Create: `sendgrid-invitation/frontend/Dockerfile`

- [ ] **Step 1: Create multi-stage Dockerfile**

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]
```

- [ ] **Step 2: Create empty public directory**

Run: `mkdir -p sendgrid-invitation/frontend/public`

Create `sendgrid-invitation/frontend/public/.gitkeep` (empty file) so the directory is tracked.

- [ ] **Step 3: Build to verify it works**

Run: `cd sendgrid-invitation && docker build -t sendgrid-invitation-frontend ./frontend`
Expected: Build completes successfully

- [ ] **Step 4: Commit**

```bash
git add sendgrid-invitation/frontend/Dockerfile sendgrid-invitation/frontend/public/.gitkeep
git commit -m "feat(sendgrid-invitation): add frontend Dockerfile"
```

---

### Task 6: nginx Configuration

**Files:**
- Create: `sendgrid-invitation/nginx/nginx.conf`

- [ ] **Step 1: Create nginx.conf**

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

- [ ] **Step 2: Commit**

```bash
git add sendgrid-invitation/nginx/
git commit -m "feat(sendgrid-invitation): add nginx reverse proxy with basic auth"
```

---

### Task 7: Docker Compose & Environment

**Files:**
- Create: `sendgrid-invitation/compose.yml`
- Create: `sendgrid-invitation/.env.server.example`

- [ ] **Step 1: Create .env.server.example**

```
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxx
FROM_EMAIL=admin@example.com
FROM_NAME=My Organization
```

- [ ] **Step 2: Create compose.yml**

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

- [ ] **Step 3: Commit**

```bash
git add sendgrid-invitation/compose.yml sendgrid-invitation/.env.server.example
git commit -m "feat(sendgrid-invitation): add Docker Compose and env example"
```

---

### Task 8: README

**Files:**
- Create: `sendgrid-invitation/README.md`

- [ ] **Step 1: Create README.md**

```markdown
# SendGrid 招待メール

組織の管理者がメンバー候補に招待メールを送るシンプルな Web アプリ。

## 構成

- **Next.js 15** — 招待フォーム UI（ポート 3000）
- **FastAPI** — SendGrid メール送信 API（ポート 8000）
- **nginx** — Basic Auth 付きリバースプロキシ（ポート 80）

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
- ConoHa アカウントと SSH キー
- SendGrid アカウントと API キー

## セットアップ

### 1. SendGrid API キーの取得

1. [SendGrid](https://sendgrid.com/) でアカウントを作成
2. Settings > API Keys で API キーを作成（Mail Send 権限）
3. Sender Authentication で送信元メールアドレスを認証

### 2. 環境変数の設定

```bash
cp .env.server.example .env.server
```

`.env.server` を編集:

```
SENDGRID_API_KEY=SG.your-api-key-here
FROM_EMAIL=admin@example.com
FROM_NAME=あなたの組織名
```

### 3. Basic Auth の設定

```bash
# htpasswd がない場合: apt install apache2-utils
htpasswd -c nginx/.htpasswd admin
```

パスワードを入力してください。

## デプロイ

```bash
# サーバー作成（2GB メモリ推奨）
conoha-cli server create --name sendgrid-invitation --image ubuntu-24.04 --flavor g2l-t-c2m2

# アプリをデプロイ
conoha-cli app deploy --name sendgrid-invitation --path ./sendgrid-invitation
```

## 動作確認

1. `http://<サーバーIP>/` にアクセス
2. Basic Auth のユーザー名・パスワードを入力
3. 招待フォームに宛先メール・名前・メッセージを入力
4. 「招待メールを送信」をクリック
5. 宛先に招待メールが届くことを確認
```

- [ ] **Step 2: Commit**

```bash
git add sendgrid-invitation/README.md
git commit -m "docs(sendgrid-invitation): add README with setup and deploy guide"
```

---

### Task 9: Update Root README

**Files:**
- Modify: `README.md` (root)

- [ ] **Step 1: Add sendgrid-invitation to the sample list in root README.md**

Find the appropriate alphabetical position in the sample list and add:

```markdown
| [sendgrid-invitation](./sendgrid-invitation/) | Next.js + FastAPI + nginx Basic Auth | SendGrid 招待メール |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add sendgrid-invitation to root README"
```
