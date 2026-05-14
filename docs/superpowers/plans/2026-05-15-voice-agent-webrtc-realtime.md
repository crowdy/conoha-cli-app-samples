# voice-agent-webrtc-realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a ConoHa VPS sample where a user scans a QR code, talks to an AI voice agent in the browser, and the conversation writes restaurant orders into Google Sheets in real time — with three switchable "communication protocol" personas.

**Architecture:** Browser connects directly to the OpenAI Realtime API over WebRTC using an ephemeral token minted by a FastAPI backend. Tool calls (`add_order` etc.) arrive on the browser's data channel; the browser calls the backend's HTTP API, which persists to Google Sheets and broadcasts the change to other sessions over a WebSocket. No audio passes through the backend (no aiortc).

**Tech Stack:** Next.js 16 (App Router, standalone), FastAPI on Python 3.12, OpenAI Realtime API (`gpt-realtime-2`), `google-api-python-client`, pytest + pytest-httpx.

**Spec:** `docs/superpowers/specs/2026-05-14-voice-agent-webrtc-realtime-design.md`

---

## File Structure

```
voice-agent-webrtc-realtime/
├── conoha.yml
├── compose.yml
├── .env.example
├── .gitignore
├── README.md
├── examples/
│   ├── sample-sheet.md
│   └── demo-script.md
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── pyproject.toml
│   └── app/
│       ├── __init__.py
│       ├── main.py              # FastAPI app factory + lifespan + /healthz
│       ├── settings.py          # os.environ.get config
│       ├── models.py            # pydantic models + order_to_row()
│       ├── store.py             # in-memory OrderStore
│       ├── sheets.py            # google-api-python-client wrapper
│       ├── broadcast.py         # in-memory WS hub + ring buffer
│       ├── tools_schema.py      # Realtime tools[] JSON
│       ├── personas/
│       │   ├── __init__.py      # loads *.md, resolve(mode)
│       │   ├── emergency.md
│       │   ├── military.md
│       │   └── callcenter.md
│       └── routers/
│           ├── __init__.py
│           ├── realtime.py      # POST /api/realtime/session
│           ├── orders.py        # POST/PATCH/POST-close/GET-recent /api/orders
│           └── events.py        # WS /api/events
│       └── tests/
│           ├── __init__.py
│           ├── conftest.py
│           ├── test_personas.py
│           ├── test_session.py
│           ├── test_store.py
│           ├── test_orders.py
│           └── test_broadcast.py
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── tsconfig.json
    ├── next.config.ts
    ├── next-env.d.ts
    ├── postcss.config.mjs
    ├── app/
    │   ├── layout.tsx
    │   ├── globals.css
    │   ├── page.tsx             # QR landing
    │   └── talk/page.tsx        # /talk?mode=...
    ├── components/
    │   ├── ModeTheme.tsx
    │   ├── PushToTalk.tsx
    │   ├── Transcript.tsx
    │   ├── OrderReceipt.tsx
    │   └── OrderTicker.tsx
    └── lib/
        ├── types.ts
        ├── realtime.ts          # WebRTC + ephemeral token
        ├── tools.ts             # tool_call → /api/orders → function_call_output
        └── events.ts            # WS /api/events subscription
```

---

## Task 1: Project skeleton

**Files:**
- Create: `voice-agent-webrtc-realtime/.gitignore`
- Create: `voice-agent-webrtc-realtime/.env.example`
- Create: `voice-agent-webrtc-realtime/compose.yml`
- Create: `voice-agent-webrtc-realtime/conoha.yml`
- Create: `voice-agent-webrtc-realtime/backend/Dockerfile`
- Create: `voice-agent-webrtc-realtime/backend/requirements.txt`
- Create: `voice-agent-webrtc-realtime/backend/requirements-dev.txt`
- Create: `voice-agent-webrtc-realtime/backend/pyproject.toml`
- Create: `voice-agent-webrtc-realtime/backend/app/__init__.py` (empty)
- Create: `voice-agent-webrtc-realtime/backend/app/settings.py`
- Create: `voice-agent-webrtc-realtime/backend/app/main.py`
- Create: `voice-agent-webrtc-realtime/frontend/package.json`
- Create: `voice-agent-webrtc-realtime/frontend/tsconfig.json`
- Create: `voice-agent-webrtc-realtime/frontend/next.config.ts`
- Create: `voice-agent-webrtc-realtime/frontend/next-env.d.ts`
- Create: `voice-agent-webrtc-realtime/frontend/postcss.config.mjs`
- Create: `voice-agent-webrtc-realtime/frontend/app/layout.tsx`
- Create: `voice-agent-webrtc-realtime/frontend/app/globals.css`
- Create: `voice-agent-webrtc-realtime/frontend/app/page.tsx` (placeholder)
- Create: `voice-agent-webrtc-realtime/frontend/Dockerfile`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
.next/
__pycache__/
*.pyc
.pytest_cache/
.env
```

- [ ] **Step 2: Create `.env.example`**

```
# OpenAI Realtime API
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_MODEL=gpt-realtime-2

# Google Sheets — paste the full service-account JSON on one line
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}
SHEET_ID=your-google-sheet-id

# Shown in the AI greeting
RESTAURANT_NAME=カフェ・コノハ
```

- [ ] **Step 3: Create `backend/requirements.txt`**

```
fastapi==0.115.6
uvicorn[standard]==0.34.0
httpx==0.28.1
google-api-python-client==2.156.0
google-auth==2.37.0
pydantic==2.10.4
```

- [ ] **Step 4: Create `backend/requirements-dev.txt`**

```
-r requirements.txt
pytest==8.3.4
pytest-asyncio==0.25.0
pytest-httpx==0.35.0
```

- [ ] **Step 5: Create `backend/pyproject.toml`**

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["app/tests"]
```

- [ ] **Step 6: Create `backend/app/__init__.py`** (empty file)

- [ ] **Step 7: Create `backend/app/settings.py`**

```python
import os

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_REALTIME_MODEL = os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-2")
GOOGLE_APPLICATION_CREDENTIALS_JSON = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON", "")
SHEET_ID = os.environ.get("SHEET_ID", "")
RESTAURANT_NAME = os.environ.get("RESTAURANT_NAME", "カフェ・コノハ")
```

- [ ] **Step 8: Create `backend/app/main.py`** (skeleton — routers added in later tasks)

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Real dependencies are attached here in later tasks. Tests pre-seed
    # app.state before entering the TestClient context, so only fill gaps.
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="voice-agent-webrtc-realtime", lifespan=lifespan)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    return app


app = create_app()
```

- [ ] **Step 9: Create `backend/Dockerfile`**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 10: Create `frontend/package.json`**

```json
{
  "name": "voice-agent-webrtc-realtime-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "16.2.2",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "qrcode": "1.5.4"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "@types/react": "19.0.2",
    "@types/react-dom": "19.0.2",
    "@types/qrcode": "1.5.5",
    "tailwindcss": "4.0.0",
    "@tailwindcss/postcss": "4.0.0",
    "typescript": "5.7.2"
  }
}
```

- [ ] **Step 11: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
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

- [ ] **Step 12: Create `frontend/next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://backend:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 13: Create `frontend/next-env.d.ts`**

```typescript
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 14: Create `frontend/postcss.config.mjs`**

```javascript
const config = {
  plugins: ["@tailwindcss/postcss"],
};

export default config;
```

- [ ] **Step 15: Create `frontend/app/globals.css`**

```css
@import "tailwindcss";

html,
body {
  margin: 0;
  padding: 0;
  background: #0a0a0a;
}
```

- [ ] **Step 16: Create `frontend/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice Agent — 注文受付 AI",
  description: "WebRTC + OpenAI Realtime API voice ordering demo",
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

- [ ] **Step 17: Create `frontend/app/page.tsx`** (placeholder, replaced in Task 13)

```tsx
export default function Home() {
  return <main className="p-8 text-white">voice-agent-webrtc-realtime</main>;
}
```

- [ ] **Step 18: Create `frontend/Dockerfile`**

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 19: Create `compose.yml`**

```yaml
services:
  frontend:
    build: ./frontend
    # No host-side port: conoha-proxy injects a randomly-bound
    # 127.0.0.1:0:3000 mapping at deploy time for blue/green slots.
    expose:
      - "3000"
    depends_on:
      backend:
        condition: service_healthy

  backend:
    build: ./backend
    expose:
      - "8000"
    environment:
      - OPENAI_API_KEY
      - OPENAI_REALTIME_MODEL
      - GOOGLE_APPLICATION_CREDENTIALS_JSON
      - SHEET_ID
      - RESTAURANT_NAME
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"]
      interval: 5s
      timeout: 5s
      retries: 5
```

- [ ] **Step 20: Create `conoha.yml`**

```yaml
name: voice-agent-webrtc-realtime
# Replace with your own FQDN before running `conoha app init`.
hosts:
  - voice-agent.example.com
web:
  service: frontend
  port: 3000
# `backend` is an accessory so it stays alive across blue/green swaps —
# only `frontend` is duplicated per slot.
accessories:
  - backend
```

- [ ] **Step 21: Generate `frontend/package-lock.json`**

Run: `cd voice-agent-webrtc-realtime/frontend && npm install`
Expected: `package-lock.json` created, `node_modules/` populated, no errors.

- [ ] **Step 22: Verify backend builds and runs**

Run: `cd voice-agent-webrtc-realtime && docker compose build backend && docker compose run --rm -p 8000:8000 -d backend && sleep 3 && curl -s localhost:8000/healthz`
Expected: `{"status":"ok"}`. Then `docker compose down`.

- [ ] **Step 23: Verify frontend builds**

Run: `cd voice-agent-webrtc-realtime && docker compose build frontend`
Expected: build completes, standalone output produced.

- [ ] **Step 24: Commit**

```bash
git add voice-agent-webrtc-realtime/
git commit -m "feat(voice-agent): project skeleton — compose, conoha.yml, Dockerfiles, healthz"
```

---

## Task 2: Persona files and loader

**Files:**
- Create: `voice-agent-webrtc-realtime/backend/app/personas/__init__.py`
- Create: `voice-agent-webrtc-realtime/backend/app/personas/emergency.md`
- Create: `voice-agent-webrtc-realtime/backend/app/personas/military.md`
- Create: `voice-agent-webrtc-realtime/backend/app/personas/callcenter.md`
- Create: `voice-agent-webrtc-realtime/backend/app/tests/__init__.py` (empty)
- Test: `voice-agent-webrtc-realtime/backend/app/tests/test_personas.py`

- [ ] **Step 1: Create `backend/app/tests/__init__.py`** (empty file)

- [ ] **Step 2: Write the failing test — `backend/app/tests/test_personas.py`**

```python
import pytest

from app.personas import resolve, PERSONAS


@pytest.mark.parametrize(
    "mode,expected_substring",
    [
        ("emergency", "救急センター"),
        ("military", "作戦司令部"),
        ("callcenter", "コールセンター"),
    ],
)
def test_resolve_returns_matching_persona(mode, expected_substring):
    resolved_mode, instructions = resolve(mode)
    assert resolved_mode == mode
    assert expected_substring in instructions


def test_resolve_unknown_mode_falls_back_to_callcenter():
    resolved_mode, instructions = resolve("bogus")
    assert resolved_mode == "callcenter"
    assert "コールセンター" in instructions


def test_all_personas_loaded():
    assert set(PERSONAS) == {"emergency", "military", "callcenter"}
    for text in PERSONAS.values():
        assert len(text) > 100
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd voice-agent-webrtc-realtime/backend && python -m pytest app/tests/test_personas.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.personas'`

- [ ] **Step 4: Create `backend/app/personas/emergency.md`**

```markdown
# 注文救急センター オペレーター

あなたは「{RESTAURANT_NAME} 注文救急センター」の AI オペレーターです。
119 番通報のような緊急無線の通信プロトコルを厳格に守ってください。

## 通信プロトコル
- 開始挨拶: 「こちら{RESTAURANT_NAME}注文救急センター、応答どうぞ」
- 短文で話す。1 ターン 2 文以内。
- お客様の発話を受けたら必ず内容を復唱する。
- ターンの最後は必ず「どうぞ」で締める。
- 注文確定時の終了挨拶: 「以上、注文救急センター、通信終了」

## 役割
- お客様の食事の注文を聴き取り、品目と数量を確認する。
- 新しい注文は add_order ツールで記録する。
- 数量や品目の変更は update_order ツールで記録する。
- お客様が「以上」と言ったら close_order ツールで確定し、終了挨拶を述べる。
- add_order が返した order_id を記憶し、以降の update_order / close_order に使う。

## 多言語対応
お客様の話す言語(日本語・英語・韓国語)を自動検出し、同じ言語で応対する。
ただし言語が変わっても本モードの緊急無線プロトコルは維持する。
- 英語: "This is {RESTAURANT_NAME} Order Emergency Center, over"
- 韓国語: 「여기는 {RESTAURANT_NAME} 주문 응급센터, 응답하라」

## 禁止事項
- 攻撃的・威圧的な表現は使わない。あくまで「形式的な厳粛さ」で演じる。
- 注文と無関係な雑談には簡潔に応じ、すぐ注文確認に戻す。
```

- [ ] **Step 5: Create `backend/app/personas/military.md`**

```markdown
# 注文作戦司令部 通信担当

あなたは「{RESTAURANT_NAME} 注文作戦司令部」の AI 通信担当です。
軍隊的な無線通信プロトコルを厳格に守ってください。

## 通信プロトコル
- 開始挨拶: 「こちら{RESTAURANT_NAME}注文作戦司令部、感度良好、送れ」
- 「了解」「確認」「通信補完」などの無線用語を使う。
- お客様の発話が不明瞭なときは「通信補完」と前置きして聞き直す。
- お客様の発話を受けたら必ず復唱する。
- ターンの最後は「送れ」または「以上」で締める。
- 注文確定時の終了挨拶: 「以上、作戦司令部、回線開放」

## 役割
- お客様の食事の注文を聴き取り、品目と数量を確認する。
- 新しい注文は add_order ツールで記録する。
- 数量や品目の変更は update_order ツールで記録する。
- お客様が「以上」と言ったら close_order ツールで確定し、終了挨拶を述べる。
- add_order が返した order_id を記憶し、以降の update_order / close_order に使う。

## 多言語対応
お客様の話す言語(日本語・英語・韓国語)を自動検出し、同じ言語で応対する。
ただし言語が変わっても本モードの軍無線プロトコルは維持する。
- 英語: "This is {RESTAURANT_NAME} Order Command, read you loud and clear, over"
- 韓国語: 「여기는 {RESTAURANT_NAME} 주문 작전사령부, 감도 양호, 송신」

## 禁止事項
- 軍事略号は雰囲気づくりのみ。実際の攻撃的・暴力的表現は使わない。
- 節度ある厳格さを保つ。
```

- [ ] **Step 6: Create `backend/app/personas/callcenter.md`**

```markdown
# 注文コールセンター オペレーター

あなたは「{RESTAURANT_NAME} 注文窓口」の AI オペレーターです。
日本の一般的なコールセンターの丁寧語プロトコルで応対してください。

## 通信プロトコル
- 開始挨拶: 「お電話ありがとうございます、{RESTAURANT_NAME}注文窓口でございます。本日はどのようなご注文でしょうか」
- 5 段階の敬語を使い、クッション言葉(「恐れ入りますが」「かしこまりました」など)を適度に挟む。
- お客様の発話を受けたら必ず「〜でございますね」と復唱して確認する。
- 注文確定時の終了挨拶: 「ご注文ありがとうございました。少々お待ちくださいませ」

## 役割
- お客様の食事の注文を聴き取り、品目と数量を確認する。
- 新しい注文は add_order ツールで記録する。
- 数量や品目の変更は update_order ツールで記録する。
- お客様が「以上」と言ったら close_order ツールで確定し、終了挨拶を述べる。
- add_order が返した order_id を記憶し、以降の update_order / close_order に使う。

## 多言語対応
お客様の話す言語(日本語・英語・韓国語)を自動検出し、同じ言語で応対する。
ただし言語が変わっても本モードの丁寧なコールセンタープロトコルは維持する。
- 英語: "Thank you for calling {RESTAURANT_NAME}. How may I help you with your order today?"
- 韓国語: 「{RESTAURANT_NAME} 주문 창구입니다. 무엇을 도와드릴까요?」

## 禁止事項
- 注文と無関係な要求には丁寧にお断りし、注文確認に戻す。
```

- [ ] **Step 7: Create `backend/app/personas/__init__.py`**

```python
from pathlib import Path

from app import settings

_DIR = Path(__file__).parent
DEFAULT_MODE = "callcenter"

_RAW = {
    "emergency": (_DIR / "emergency.md").read_text(encoding="utf-8"),
    "military": (_DIR / "military.md").read_text(encoding="utf-8"),
    "callcenter": (_DIR / "callcenter.md").read_text(encoding="utf-8"),
}

# {RESTAURANT_NAME} is substituted once at import time.
PERSONAS = {
    mode: text.replace("{RESTAURANT_NAME}", settings.RESTAURANT_NAME)
    for mode, text in _RAW.items()
}


def resolve(mode: str) -> tuple[str, str]:
    """Return (mode, instructions). Unknown modes fall back to callcenter."""
    if mode not in PERSONAS:
        mode = DEFAULT_MODE
    return mode, PERSONAS[mode]
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd voice-agent-webrtc-realtime/backend && python -m pytest app/tests/test_personas.py -v`
Expected: PASS (5 tests — 3 parametrized + 2)

- [ ] **Step 9: Commit**

```bash
git add voice-agent-webrtc-realtime/backend/app/personas voice-agent-webrtc-realtime/backend/app/tests
git commit -m "feat(voice-agent): 3 persona prompts + loader with RESTAURANT_NAME substitution"
```

---

## Task 3: Tools schema

**Files:**
- Create: `voice-agent-webrtc-realtime/backend/app/tools_schema.py`

- [ ] **Step 1: Create `backend/app/tools_schema.py`**

```python
"""OpenAI Realtime API function tool definitions.

These are returned verbatim inside the /api/realtime/session response and
sent by the browser in session.update. Tool calls are executed in the
browser (see frontend/lib/tools.ts), which then calls the backend HTTP API.
"""

_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "qty": {"type": "integer", "minimum": 1},
        "note": {"type": ["string", "null"]},
    },
    "required": ["name", "qty"],
}

TOOLS = [
    {
        "type": "function",
        "name": "add_order",
        "description": (
            "新しい注文を業務システムに追加する。お客様が注文した品目と数量を "
            "items 配列にすべて含めること。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "items": {"type": "array", "items": _ITEM_SCHEMA},
                "customer_label": {
                    "type": "string",
                    "description": "席・現場の呼称。モードに応じた言い回しを採用",
                },
                "language": {"type": "string", "enum": ["ja", "en", "ko"]},
            },
            "required": ["items", "language"],
        },
    },
    {
        "type": "function",
        "name": "update_order",
        "description": "直前の注文の数量や品目を変更する。items は差分ではなく変更後の全品目。",
        "parameters": {
            "type": "object",
            "properties": {
                "order_id": {"type": "string"},
                "items": {"type": "array", "items": _ITEM_SCHEMA},
                "notes": {"type": ["string", "null"]},
            },
            "required": ["order_id", "items"],
        },
    },
    {
        "type": "function",
        "name": "close_order",
        "description": "注文を確定する。お礼の言葉の直前に呼ぶこと。",
        "parameters": {
            "type": "object",
            "properties": {"order_id": {"type": "string"}},
            "required": ["order_id"],
        },
    },
    {
        "type": "function",
        "name": "list_orders",
        "description": "当日の最近の注文を確認する(使用頻度低、復旧用)。",
        "parameters": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "default": 10}},
            "required": [],
        },
    },
]
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `cd voice-agent-webrtc-realtime/backend && python -c "from app.tools_schema import TOOLS; print(len(TOOLS), [t['name'] for t in TOOLS])"`
Expected: `4 ['add_order', 'update_order', 'close_order', 'list_orders']`

- [ ] **Step 3: Commit**

```bash
git add voice-agent-webrtc-realtime/backend/app/tools_schema.py
git commit -m "feat(voice-agent): Realtime API tools[] schema"
```

---

## Task 4: Models and OrderStore

**Files:**
- Create: `voice-agent-webrtc-realtime/backend/app/models.py`
- Create: `voice-agent-webrtc-realtime/backend/app/store.py`
- Test: `voice-agent-webrtc-realtime/backend/app/tests/test_store.py`

- [ ] **Step 1: Write the failing test — `backend/app/tests/test_store.py`**

```python
from app.models import OrderItem
from app.store import OrderStore


def _items():
    return [OrderItem(name="カルボナーラ", qty=2)]


def test_create_assigns_id_and_open_status():
    store = OrderStore()
    order = store.create("emergency", "現場 α", "ja", _items())
    assert order.order_id.startswith("ord_")
    assert order.status == "open"
    assert order.mode == "emergency"
    assert order.items[0].name == "カルボナーラ"


def test_get_returns_created_order():
    store = OrderStore()
    order = store.create("callcenter", None, "ja", _items())
    assert store.get(order.order_id) is order


def test_get_unknown_returns_none():
    assert OrderStore().get("ord_missing") is None


def test_update_replaces_items_and_notes():
    store = OrderStore()
    order = store.create("military", None, "ja", _items())
    updated = store.update(
        order.order_id, [OrderItem(name="ピザ", qty=1)], "変更しました"
    )
    assert updated.items[0].name == "ピザ"
    assert updated.notes == "変更しました"
    assert store.get(order.order_id).items[0].name == "ピザ"


def test_close_sets_status():
    store = OrderStore()
    order = store.create("callcenter", None, "ja", _items())
    closed = store.close(order.order_id)
    assert closed.status == "closed"


def test_delete_removes_order():
    store = OrderStore()
    order = store.create("callcenter", None, "ja", _items())
    store.delete(order.order_id)
    assert store.get(order.order_id) is None


def test_recent_returns_last_n_in_order():
    store = OrderStore()
    ids = [store.create("callcenter", None, "ja", _items()).order_id for _ in range(5)]
    recent = store.recent(3)
    assert [o.order_id for o in recent] == ids[-3:]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd voice-agent-webrtc-realtime/backend && python -m pytest app/tests/test_store.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models'`

- [ ] **Step 3: Create `backend/app/models.py`**

```python
import json
from typing import Literal

from pydantic import BaseModel

Mode = Literal["emergency", "military", "callcenter"]
Language = Literal["ja", "en", "ko"]
Status = Literal["open", "closed"]


class OrderItem(BaseModel):
    name: str
    qty: int
    note: str | None = None


class Order(BaseModel):
    order_id: str
    created_at: str
    mode: Mode
    customer_label: str | None
    items: list[OrderItem]
    language: Language
    status: Status
    notes: str | None = None


class CreateOrderRequest(BaseModel):
    mode: Mode
    customer_label: str | None = None
    language: Language
    items: list[OrderItem]


class UpdateOrderRequest(BaseModel):
    items: list[OrderItem]
    notes: str | None = None


class SessionRequest(BaseModel):
    mode: str  # validated/normalised by personas.resolve()


def order_to_row(order: Order) -> list[str]:
    """Serialise an Order into the 8-column Google Sheets row layout."""
    return [
        order.order_id,
        order.created_at,
        order.mode,
        order.customer_label or "",
        json.dumps([i.model_dump() for i in order.items], ensure_ascii=False),
        order.language,
        order.status,
        order.notes or "",
    ]
```

- [ ] **Step 4: Create `backend/app/store.py`**

```python
from collections import OrderedDict
from datetime import datetime, timezone
from uuid import uuid4

from app.models import Language, Mode, Order, OrderItem


class OrderStore:
    """In-memory order store. Google Sheets is the durable copy;
    this is the fast path for update/close/recent lookups."""

    def __init__(self) -> None:
        self._orders: "OrderedDict[str, Order]" = OrderedDict()

    def create(
        self,
        mode: Mode,
        customer_label: str | None,
        language: Language,
        items: list[OrderItem],
    ) -> Order:
        order = Order(
            order_id="ord_" + uuid4().hex[:16],
            created_at=datetime.now(timezone.utc).isoformat(),
            mode=mode,
            customer_label=customer_label,
            items=items,
            language=language,
            status="open",
            notes=None,
        )
        self._orders[order.order_id] = order
        return order

    def get(self, order_id: str) -> Order | None:
        return self._orders.get(order_id)

    def update(
        self, order_id: str, items: list[OrderItem], notes: str | None
    ) -> Order:
        order = self._orders[order_id]
        updated = order.model_copy(update={"items": items, "notes": notes})
        self._orders[order_id] = updated
        return updated

    def close(self, order_id: str) -> Order:
        order = self._orders[order_id]
        updated = order.model_copy(update={"status": "closed"})
        self._orders[order_id] = updated
        return updated

    def delete(self, order_id: str) -> None:
        self._orders.pop(order_id, None)

    def recent(self, limit: int) -> list[Order]:
        return list(self._orders.values())[-limit:]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd voice-agent-webrtc-realtime/backend && python -m pytest app/tests/test_store.py -v`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add voice-agent-webrtc-realtime/backend/app/models.py voice-agent-webrtc-realtime/backend/app/store.py voice-agent-webrtc-realtime/backend/app/tests/test_store.py
git commit -m "feat(voice-agent): pydantic models + in-memory OrderStore"
```

---

## Task 5: Sheets client

**Files:**
- Create: `voice-agent-webrtc-realtime/backend/app/sheets.py`

This module wraps `google-api-python-client`. It has no unit test of its own (it only forwards to the Google SDK); it is exercised through a fake in `conftest.py` in Task 7. The interface defined here is what the fake must match.

- [ ] **Step 1: Create `backend/app/sheets.py`**

```python
import json

from google.oauth2 import service_account
from googleapiclient.discovery import build

_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
_RANGE_ALL = "Orders!A:H"


class SheetsClient:
    """Thin wrapper over the Google Sheets v4 API.

    Row layout (see app.models.order_to_row):
      A order_id | B created_at | C mode | D customer_label
      E items_json | F language | G status | H notes
    """

    def __init__(self, credentials_json: str, sheet_id: str) -> None:
        info = json.loads(credentials_json)
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=_SCOPES
        )
        self._svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
        self._sheet_id = sheet_id

    def append_order(self, row: list[str]) -> None:
        self._svc.spreadsheets().values().append(
            spreadsheetId=self._sheet_id,
            range=_RANGE_ALL,
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": [row]},
        ).execute()

    def find_row(self, order_id: str) -> int | None:
        """Return the 1-based row number whose column A equals order_id."""
        resp = (
            self._svc.spreadsheets()
            .values()
            .get(spreadsheetId=self._sheet_id, range="Orders!A:A")
            .execute()
        )
        for idx, row in enumerate(resp.get("values", [])):
            if row and row[0] == order_id:
                return idx + 1
        return None

    def update_row(self, row_number: int, row: list[str]) -> None:
        self._svc.spreadsheets().values().update(
            spreadsheetId=self._sheet_id,
            range=f"Orders!A{row_number}:H{row_number}",
            valueInputOption="USER_ENTERED",
            body={"values": [row]},
        ).execute()
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `cd voice-agent-webrtc-realtime/backend && python -c "from app.sheets import SheetsClient; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add voice-agent-webrtc-realtime/backend/app/sheets.py
git commit -m "feat(voice-agent): Google Sheets client wrapper"
```

---

## Task 6: Broadcast hub

**Files:**
- Create: `voice-agent-webrtc-realtime/backend/app/broadcast.py`

The hub is unit-tested via the WebSocket route in Task 8 (`test_broadcast.py`). Defining it here keeps it a small, focused module.

- [ ] **Step 1: Create `backend/app/broadcast.py`**

```python
import asyncio
from collections import deque
from typing import Any


class BroadcastHub:
    """In-memory pub/sub for order events.

    Keeps a ring buffer of recent events so a freshly connected client can
    be brought up to date. Single-process only — see the spec's scope note.
    """

    def __init__(self, history_size: int = 50) -> None:
        self._clients: set[asyncio.Queue] = set()
        self._history: deque[dict[str, Any]] = deque(maxlen=history_size)

    def history(self) -> list[dict[str, Any]]:
        return list(self._history)

    async def publish(self, event: dict[str, Any]) -> None:
        self._history.append(event)
        for queue in list(self._clients):
            await queue.put(event)

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._clients.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._clients.discard(queue)
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `cd voice-agent-webrtc-realtime/backend && python -c "from app.broadcast import BroadcastHub; h=BroadcastHub(); print(h.history())"`
Expected: `[]`

- [ ] **Step 3: Commit**

```bash
git add voice-agent-webrtc-realtime/backend/app/broadcast.py
git commit -m "feat(voice-agent): in-memory broadcast hub with ring buffer"
```

---

## Task 7: Realtime session endpoint + orders endpoints + wiring

**Files:**
- Create: `voice-agent-webrtc-realtime/backend/app/routers/__init__.py` (empty)
- Create: `voice-agent-webrtc-realtime/backend/app/routers/realtime.py`
- Create: `voice-agent-webrtc-realtime/backend/app/routers/orders.py`
- Modify: `voice-agent-webrtc-realtime/backend/app/main.py`
- Create: `voice-agent-webrtc-realtime/backend/app/tests/conftest.py`
- Test: `voice-agent-webrtc-realtime/backend/app/tests/test_session.py`
- Test: `voice-agent-webrtc-realtime/backend/app/tests/test_orders.py`

- [ ] **Step 1: Create `backend/app/routers/__init__.py`** (empty file)

- [ ] **Step 2: Create `backend/app/tests/conftest.py`**

```python
import pytest
from fastapi.testclient import TestClient

from app.broadcast import BroadcastHub
from app.main import create_app
from app.store import OrderStore


class FakeSheets:
    """Stand-in for app.sheets.SheetsClient. Matches its public interface."""

    def __init__(self) -> None:
        self.appended: list[list[str]] = []
        self.updated: list[tuple[int, list[str]]] = []
        self._rows: dict[str, int] = {}
        self.fail = False

    def append_order(self, row: list[str]) -> None:
        if self.fail:
            raise RuntimeError("sheets down")
        self.appended.append(row)
        self._rows[row[0]] = len(self.appended) + 1

    def find_row(self, order_id: str) -> int | None:
        return self._rows.get(order_id)

    def update_row(self, row_number: int, row: list[str]) -> None:
        self.updated.append((row_number, row))


@pytest.fixture
def app():
    application = create_app()
    # Pre-seed app.state so lifespan leaves these untouched (no real network).
    application.state.sheets = FakeSheets()
    application.state.hub = BroadcastHub()
    application.state.store = OrderStore()
    return application


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client
```

- [ ] **Step 3: Write the failing test — `backend/app/tests/test_session.py`**

```python
import pytest

_SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions"


@pytest.mark.parametrize(
    "mode,expected_substring",
    [
        ("emergency", "救急センター"),
        ("military", "作戦司令部"),
        ("callcenter", "コールセンター"),
        ("bogus", "コールセンター"),  # unknown mode falls back to callcenter
    ],
)
def test_session_embeds_persona(client, httpx_mock, mode, expected_substring):
    httpx_mock.add_response(
        url=_SESSIONS_URL,
        json={
            "client_secret": {
                "value": "ek_test_123",
                "expires_at": "2026-05-15T00:01:00Z",
            }
        },
    )
    res = client.post("/api/realtime/session", json={"mode": mode})
    assert res.status_code == 200
    body = res.json()
    assert body["client_secret"] == "ek_test_123"
    assert body["expires_at"] == "2026-05-15T00:01:00Z"
    assert expected_substring in body["session"]["instructions"]
    assert body["session"]["turn_detection"] == {"type": "none"}
    assert [t["name"] for t in body["session"]["tools"]] == [
        "add_order",
        "update_order",
        "close_order",
        "list_orders",
    ]


def test_session_openai_error_returns_503(client, httpx_mock):
    httpx_mock.add_response(url=_SESSIONS_URL, status_code=429)
    res = client.post("/api/realtime/session", json={"mode": "emergency"})
    assert res.status_code == 503
```

- [ ] **Step 4: Write the failing test — `backend/app/tests/test_orders.py`**

```python
def _create(client, **overrides):
    payload = {
        "mode": "emergency",
        "customer_label": "現場 α",
        "language": "ja",
        "items": [{"name": "カルボナーラ", "qty": 2}],
    }
    payload.update(overrides)
    return client.post("/api/orders", json=payload)


def test_create_order_appends_to_sheets_and_broadcasts(client, app):
    res = _create(client)
    assert res.status_code == 201
    order = res.json()
    assert order["order_id"].startswith("ord_")
    assert order["status"] == "open"

    assert len(app.state.sheets.appended) == 1
    assert app.state.sheets.appended[0][0] == order["order_id"]

    history = app.state.hub.history()
    assert history[-1]["type"] == "order_added"
    assert history[-1]["payload"]["order_id"] == order["order_id"]


def test_create_order_sheets_failure_returns_502_and_rolls_back(client, app):
    app.state.sheets.fail = True
    res = _create(client)
    assert res.status_code == 502
    assert app.state.hub.history() == []
    assert app.state.store.recent(10) == []


def test_update_order_replaces_items(client, app):
    order = _create(client).json()
    res = client.patch(
        f"/api/orders/{order['order_id']}",
        json={"items": [{"name": "カルボナーラ", "qty": 3}], "notes": "3つに変更"},
    )
    assert res.status_code == 200
    assert res.json()["items"][0]["qty"] == 3
    assert len(app.state.sheets.updated) == 1
    assert app.state.hub.history()[-1]["type"] == "order_updated"


def test_update_unknown_order_returns_404(client):
    res = client.patch(
        "/api/orders/ord_missing", json={"items": [{"name": "x", "qty": 1}]}
    )
    assert res.status_code == 404


def test_close_order_sets_status_closed(client, app):
    order = _create(client).json()
    res = client.post(f"/api/orders/{order['order_id']}/close")
    assert res.status_code == 200
    assert res.json()["status"] == "closed"
    assert app.state.hub.history()[-1]["type"] == "order_closed"


def test_close_unknown_order_returns_404(client):
    res = client.post("/api/orders/ord_missing/close")
    assert res.status_code == 404


def test_recent_orders_returns_last_n(client):
    for i in range(4):
        _create(client, items=[{"name": f"品{i}", "qty": 1}])
    res = client.get("/api/orders/recent?limit=2")
    assert res.status_code == 200
    assert len(res.json()["orders"]) == 2
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd voice-agent-webrtc-realtime/backend && python -m pytest app/tests/test_session.py app/tests/test_orders.py -v`
Expected: FAIL — `/api/realtime/session` and `/api/orders` return 404 (routes not registered)

- [ ] **Step 6: Create `backend/app/routers/realtime.py`**

```python
import httpx
from fastapi import APIRouter, HTTPException

from app import settings
from app.models import SessionRequest
from app.personas import resolve
from app.tools_schema import TOOLS

router = APIRouter(prefix="/api/realtime", tags=["realtime"])

_OPENAI_SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions"


@router.post("/session")
async def create_session(req: SessionRequest):
    mode, instructions = resolve(req.mode)

    try:
        async with httpx.AsyncClient(timeout=10) as http:
            resp = await http.post(
                _OPENAI_SESSIONS_URL,
                headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                json={"model": settings.OPENAI_REALTIME_MODEL, "voice": "alloy"},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="OpenAI unreachable") from exc

    if resp.status_code != 200:
        raise HTTPException(status_code=503, detail="OpenAI session error")

    secret = resp.json()["client_secret"]
    return {
        "client_secret": secret["value"],
        "expires_at": secret["expires_at"],
        "model": settings.OPENAI_REALTIME_MODEL,
        "session": {
            "instructions": instructions,
            "voice": "alloy",
            "input_audio_transcription": {"model": "whisper-1"},
            "turn_detection": {"type": "none"},
            "tools": TOOLS,
        },
    }
```

- [ ] **Step 7: Create `backend/app/routers/orders.py`**

```python
from fastapi import APIRouter, HTTPException, Request

from app.models import CreateOrderRequest, Order, UpdateOrderRequest, order_to_row

router = APIRouter(prefix="/api/orders", tags=["orders"])


async def _persist_new(request: Request, order: Order) -> None:
    """Append to Sheets; on failure roll the order out of the store."""
    try:
        request.app.state.sheets.append_order(order_to_row(order))
    except Exception as exc:
        request.app.state.store.delete(order.order_id)
        raise HTTPException(status_code=502, detail="sheets append failed") from exc


async def _persist_update(request: Request, order: Order) -> None:
    row_number = request.app.state.sheets.find_row(order.order_id)
    if row_number is None:
        raise HTTPException(status_code=502, detail="sheets row not found")
    request.app.state.sheets.update_row(row_number, order_to_row(order))


@router.post("", status_code=201)
async def create_order(req: CreateOrderRequest, request: Request) -> Order:
    order = request.app.state.store.create(
        req.mode, req.customer_label, req.language, req.items
    )
    await _persist_new(request, order)
    await request.app.state.hub.publish(
        {"type": "order_added", "payload": order.model_dump()}
    )
    return order


@router.patch("/{order_id}")
async def update_order(
    order_id: str, req: UpdateOrderRequest, request: Request
) -> Order:
    if request.app.state.store.get(order_id) is None:
        raise HTTPException(status_code=404, detail="order not found")
    order = request.app.state.store.update(order_id, req.items, req.notes)
    await _persist_update(request, order)
    await request.app.state.hub.publish(
        {"type": "order_updated", "payload": order.model_dump()}
    )
    return order


@router.post("/{order_id}/close")
async def close_order(order_id: str, request: Request) -> Order:
    if request.app.state.store.get(order_id) is None:
        raise HTTPException(status_code=404, detail="order not found")
    order = request.app.state.store.close(order_id)
    await _persist_update(request, order)
    await request.app.state.hub.publish(
        {"type": "order_closed", "payload": order.model_dump()}
    )
    return order


@router.get("/recent")
async def recent_orders(request: Request, limit: int = 20) -> dict:
    orders = request.app.state.store.recent(limit)
    return {"orders": [o.model_dump() for o in orders]}
```

- [ ] **Step 8: Modify `backend/app/main.py`** — wire dependencies + routers

Replace the entire file with:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import settings
from app.broadcast import BroadcastHub
from app.routers import orders, realtime
from app.sheets import SheetsClient
from app.store import OrderStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tests pre-seed app.state before entering the TestClient context,
    # so only create real dependencies when they are missing.
    if not hasattr(app.state, "sheets"):
        app.state.sheets = SheetsClient(
            settings.GOOGLE_APPLICATION_CREDENTIALS_JSON, settings.SHEET_ID
        )
    if not hasattr(app.state, "hub"):
        app.state.hub = BroadcastHub()
    if not hasattr(app.state, "store"):
        app.state.store = OrderStore()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="voice-agent-webrtc-realtime", lifespan=lifespan)
    app.include_router(realtime.router)
    app.include_router(orders.router)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    return app


app = create_app()
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd voice-agent-webrtc-realtime/backend && python -m pytest app/tests/test_session.py app/tests/test_orders.py -v`
Expected: PASS (6 session tests — 4 parametrized + 2; 7 order tests)

- [ ] **Step 10: Run the full backend suite**

Run: `cd voice-agent-webrtc-realtime/backend && python -m pytest -v`
Expected: PASS (all tests from Tasks 2, 4, 7)

- [ ] **Step 11: Commit**

```bash
git add voice-agent-webrtc-realtime/backend/app/routers voice-agent-webrtc-realtime/backend/app/main.py voice-agent-webrtc-realtime/backend/app/tests/conftest.py voice-agent-webrtc-realtime/backend/app/tests/test_session.py voice-agent-webrtc-realtime/backend/app/tests/test_orders.py
git commit -m "feat(voice-agent): realtime session + orders endpoints with Sheets + broadcast wiring"
```

---

## Task 8: Events WebSocket

**Files:**
- Create: `voice-agent-webrtc-realtime/backend/app/routers/events.py`
- Modify: `voice-agent-webrtc-realtime/backend/app/main.py`
- Test: `voice-agent-webrtc-realtime/backend/app/tests/test_broadcast.py`

- [ ] **Step 1: Write the failing test — `backend/app/tests/test_broadcast.py`**

```python
def _create(client, name="うどん"):
    return client.post(
        "/api/orders",
        json={
            "mode": "emergency",
            "customer_label": "現場 β",
            "language": "ja",
            "items": [{"name": name, "qty": 1}],
        },
    )


def test_ws_receives_event_published_after_connect(client):
    with client.websocket_connect("/api/events") as ws:
        _create(client, name="うどん")
        evt = ws.receive_json()
        assert evt["type"] == "order_added"
        assert evt["payload"]["items"][0]["name"] == "うどん"


def test_ws_replays_history_on_connect(client):
    _create(client, name="そば")
    with client.websocket_connect("/api/events") as ws:
        evt = ws.receive_json()
        assert evt["type"] == "order_added"
        assert evt["payload"]["items"][0]["name"] == "そば"


def test_two_ws_clients_both_receive(client):
    with client.websocket_connect("/api/events") as ws_a:
        with client.websocket_connect("/api/events") as ws_b:
            _create(client, name="天ぷら")
            assert ws_a.receive_json()["payload"]["items"][0]["name"] == "天ぷら"
            assert ws_b.receive_json()["payload"]["items"][0]["name"] == "天ぷら"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd voice-agent-webrtc-realtime/backend && python -m pytest app/tests/test_broadcast.py -v`
Expected: FAIL — WebSocket connection to `/api/events` rejected (route not registered)

- [ ] **Step 3: Create `backend/app/routers/events.py`**

```python
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


@router.websocket("/api/events")
async def events_ws(ws: WebSocket) -> None:
    await ws.accept()
    hub = ws.app.state.hub

    # Bring a freshly connected client up to date.
    for event in hub.history():
        await ws.send_json(event)

    queue = hub.subscribe()
    try:
        while True:
            event = await queue.get()
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        hub.unsubscribe(queue)
```

- [ ] **Step 4: Modify `backend/app/main.py`** — register the events router

In `create_app()`, change the import line and add the router registration:

Change:
```python
from app.routers import orders, realtime
```
to:
```python
from app.routers import events, orders, realtime
```

And after `app.include_router(orders.router)` add:
```python
    app.include_router(events.router)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd voice-agent-webrtc-realtime/backend && python -m pytest app/tests/test_broadcast.py -v`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full backend suite**

Run: `cd voice-agent-webrtc-realtime/backend && python -m pytest -v`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add voice-agent-webrtc-realtime/backend/app/routers/events.py voice-agent-webrtc-realtime/backend/app/main.py voice-agent-webrtc-realtime/backend/app/tests/test_broadcast.py
git commit -m "feat(voice-agent): /api/events WebSocket broadcast endpoint"
```

---

## Task 9: Frontend shared types, ModeTheme, and realtime library

**Files:**
- Create: `voice-agent-webrtc-realtime/frontend/lib/types.ts`
- Create: `voice-agent-webrtc-realtime/frontend/components/ModeTheme.tsx`
- Create: `voice-agent-webrtc-realtime/frontend/lib/realtime.ts`

This task has no automated test (WebRTC needs a real browser + OpenAI). Verification is `npm run build` plus a manual smoke test in Task 10 once the talk page exists.

- [ ] **Step 1: Create `frontend/lib/types.ts`**

```typescript
export type Mode = "emergency" | "military" | "callcenter";
export type Language = "ja" | "en" | "ko";

export interface OrderItem {
  name: string;
  qty: number;
  note?: string | null;
}

export interface Order {
  order_id: string;
  created_at: string;
  mode: Mode;
  customer_label?: string | null;
  items: OrderItem[];
  language: Language;
  status: "open" | "closed";
  notes?: string | null;
}

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  done: boolean;
}

export interface TickerEvent {
  type: "order_added" | "order_updated" | "order_closed";
  payload: Order;
}

export const MODES: Mode[] = ["emergency", "military", "callcenter"];

export function isMode(value: string | null): value is Mode {
  return value === "emergency" || value === "military" || value === "callcenter";
}
```

- [ ] **Step 2: Create `frontend/components/ModeTheme.tsx`**

```tsx
import type { Mode } from "@/lib/types";

export interface ModeStyle {
  label: string;
  emoji: string;
  /** Tailwind classes for the page background + base text. */
  page: string;
  /** Tailwind classes for the mode badge. */
  badge: string;
  /** Tailwind classes for the push-to-talk button. */
  button: string;
  /** Font family utility class. */
  font: string;
}

export const MODE_STYLES: Record<Mode, ModeStyle> = {
  emergency: {
    label: "注文救急センター",
    emoji: "🚑",
    page: "bg-red-950 text-red-50",
    badge: "bg-red-600 text-white",
    button: "bg-red-600 hover:bg-red-500 text-white",
    font: "font-mono",
  },
  military: {
    label: "注文作戦司令部",
    emoji: "🪖",
    page: "bg-green-950 text-yellow-50",
    badge: "bg-green-700 text-yellow-100",
    button: "bg-green-700 hover:bg-green-600 text-yellow-100",
    font: "font-mono",
  },
  callcenter: {
    label: "注文コールセンター",
    emoji: "☎️",
    page: "bg-white text-slate-900",
    badge: "bg-blue-900 text-white",
    button: "bg-blue-900 hover:bg-blue-800 text-white",
    font: "font-sans",
  },
};

export function ModeBadge({ mode }: { mode: Mode }) {
  const style = MODE_STYLES[mode];
  return (
    <div className={`inline-flex items-center gap-2 rounded px-3 py-1 text-sm font-bold ${style.badge}`}>
      <span>{style.emoji}</span>
      <span>{style.label}</span>
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/lib/realtime.ts`**

```typescript
import type { Mode } from "@/lib/types";

export interface RealtimeSession {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  audioEl: HTMLAudioElement;
  micTrack: MediaStreamTrack;
}

interface SessionConfig {
  client_secret: string;
  expires_at: string;
  model: string;
  session: Record<string, unknown>;
}

/**
 * Mint an ephemeral token from our backend, then open a direct WebRTC
 * connection to the OpenAI Realtime API. All Realtime events arrive on the
 * "oai-events" data channel and are forwarded to `onEvent`.
 *
 * The mic track is added but starts disabled — see setMicEnabled (push-to-talk).
 */
export async function startRealtime(
  mode: Mode,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<RealtimeSession> {
  const res = await fetch("/api/realtime/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    throw new Error(`session request failed: ${res.status}`);
  }
  const cfg: SessionConfig = await res.json();

  const pc = new RTCPeerConnection();

  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  pc.ontrack = (e) => {
    audioEl.srcObject = e.streams[0];
  };

  // getUserMedia must be called from a user-gesture chain (see PushToTalk).
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  const micTrack = mic.getAudioTracks()[0];
  micTrack.enabled = false;
  pc.addTrack(micTrack, mic);

  const dc = pc.createDataChannel("oai-events");
  dc.addEventListener("message", (e) => {
    onEvent(JSON.parse(e.data));
  });
  dc.addEventListener("open", () => {
    dc.send(JSON.stringify({ type: "session.update", session: cfg.session }));
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpRes = await fetch(
    `https://api.openai.com/v1/realtime?model=${cfg.model}`,
    {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${cfg.client_secret}`,
        "Content-Type": "application/sdp",
      },
    },
  );
  if (!sdpRes.ok) {
    throw new Error(`OpenAI SDP exchange failed: ${sdpRes.status}`);
  }
  await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

  return { pc, dc, audioEl, micTrack };
}

export function setMicEnabled(session: RealtimeSession, enabled: boolean): void {
  session.micTrack.enabled = enabled;
}

/** Send a client event over the Realtime data channel. */
export function sendEvent(
  session: RealtimeSession,
  event: Record<string, unknown>,
): void {
  session.dc.send(JSON.stringify(event));
}

export function closeRealtime(session: RealtimeSession): void {
  session.micTrack.stop();
  session.dc.close();
  session.pc.close();
}
```

- [ ] **Step 4: Verify the frontend type-checks and builds**

Run: `cd voice-agent-webrtc-realtime/frontend && npm run build`
Expected: build succeeds (the placeholder `app/page.tsx` from Task 1 is still present; no type errors).

- [ ] **Step 5: Commit**

```bash
git add voice-agent-webrtc-realtime/frontend/lib/types.ts voice-agent-webrtc-realtime/frontend/lib/realtime.ts voice-agent-webrtc-realtime/frontend/components/ModeTheme.tsx
git commit -m "feat(voice-agent): frontend shared types, ModeTheme, WebRTC realtime lib"
```

---

## Task 10: Talk page — PushToTalk + Transcript (audio working end to end)

**Files:**
- Create: `voice-agent-webrtc-realtime/frontend/components/PushToTalk.tsx`
- Create: `voice-agent-webrtc-realtime/frontend/components/Transcript.tsx`
- Create: `voice-agent-webrtc-realtime/frontend/app/talk/page.tsx`

After this task a user can open `/talk?mode=...`, hold the button, speak, and hear the AI reply, with live subtitles. Tool calls are not wired yet (Task 11).

- [ ] **Step 1: Create `frontend/components/PushToTalk.tsx`**

```tsx
"use client";

import type { ModeStyle } from "@/components/ModeTheme";

interface PushToTalkProps {
  style: ModeStyle;
  /** true once the WebRTC session is connected. */
  ready: boolean;
  talking: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function PushToTalk({
  style,
  ready,
  talking,
  onStart,
  onStop,
}: PushToTalkProps) {
  return (
    <button
      type="button"
      disabled={!ready}
      onPointerDown={onStart}
      onPointerUp={onStop}
      onPointerLeave={() => talking && onStop()}
      className={`w-full rounded-xl py-6 text-xl font-bold select-none transition disabled:opacity-40 ${style.button} ${
        talking ? "scale-95 ring-4 ring-white/40" : ""
      }`}
    >
      {ready ? (talking ? "🎤 録音中…" : "🎤 PRESS TO TALK") : "接続中…"}
    </button>
  );
}
```

- [ ] **Step 2: Create `frontend/components/Transcript.tsx`**

```tsx
"use client";

import type { TranscriptEntry } from "@/lib/types";

export function Transcript({ entries }: { entries: TranscriptEntry[] }) {
  return (
    <section className="rounded-lg bg-black/20 p-4">
      <h2 className="mb-2 text-sm font-bold opacity-70">💬 会話</h2>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={entry.role === "user" ? "text-right" : "text-left"}
          >
            <span
              className={`inline-block rounded-lg px-3 py-1 text-sm ${
                entry.role === "user"
                  ? "bg-white/15"
                  : "bg-white/5 border border-white/10"
              }`}
            >
              <strong className="opacity-60">
                {entry.role === "user" ? "あなた" : "AI"}:{" "}
              </strong>
              {entry.text}
            </span>
          </li>
        ))}
        {entries.length === 0 && (
          <li className="text-sm opacity-40">ボタンを押して話しかけてください</li>
        )}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Create `frontend/app/talk/page.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ModeBadge, MODE_STYLES } from "@/components/ModeTheme";
import { PushToTalk } from "@/components/PushToTalk";
import { Transcript } from "@/components/Transcript";
import {
  closeRealtime,
  sendEvent,
  setMicEnabled,
  startRealtime,
  type RealtimeSession,
} from "@/lib/realtime";
import { isMode, type Mode, type TranscriptEntry } from "@/lib/types";

export default function TalkPage() {
  const params = useSearchParams();
  const rawMode = params.get("mode");
  const mode: Mode = isMode(rawMode) ? rawMode : "callcenter";
  const style = MODE_STYLES[mode];

  const sessionRef = useRef<RealtimeSession | null>(null);
  const [ready, setReady] = useState(false);
  const [talking, setTalking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  // Append assistant transcript deltas, or push a finished user line.
  function handleEvent(event: Record<string, unknown>) {
    const type = event.type as string;

    if (type === "response.audio_transcript.delta") {
      const delta = event.delta as string;
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && !last.done) {
          return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
        }
        return [
          ...prev,
          {
            id: `a-${Date.now()}-${Math.random()}`,
            role: "assistant",
            text: delta,
            done: false,
          },
        ];
      });
    } else if (type === "response.audio_transcript.done") {
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && !last.done) {
          return [...prev.slice(0, -1), { ...last, done: true }];
        }
        return prev;
      });
    } else if (
      type === "conversation.item.input_audio_transcription.completed"
    ) {
      setTranscript((prev) => [
        ...prev,
        {
          id: `u-${Date.now()}-${Math.random()}`,
          role: "user",
          text: event.transcript as string,
          done: true,
        },
      ]);
    }
  }

  // PushToTalk's onPointerDown is the user gesture that lets iOS Safari
  // grant getUserMedia; the WebRTC session is created on first press.
  async function handleStart() {
    setError(null);
    if (!sessionRef.current) {
      try {
        sessionRef.current = await startRealtime(mode, handleEvent);
        setReady(true);
      } catch (err) {
        setError(`接続に失敗しました: ${String(err)}`);
        return;
      }
    }
    setMicEnabled(sessionRef.current, true);
    setTalking(true);
  }

  function handleStop() {
    setTalking(false);
    const session = sessionRef.current;
    if (!session) return;
    setMicEnabled(session, false);
    // Push-to-talk: end the user turn and ask for a response.
    sendEvent(session, { type: "input_audio_buffer.commit" });
    sendEvent(session, { type: "response.create" });
  }

  useEffect(() => {
    return () => {
      if (sessionRef.current) closeRealtime(sessionRef.current);
    };
  }, []);

  return (
    <main
      className={`min-h-screen p-4 flex flex-col gap-4 ${style.page} ${style.font}`}
    >
      <ModeBadge mode={mode} />
      {error && (
        <div className="rounded bg-black/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      <Transcript entries={transcript} />
      <PushToTalk
        style={style}
        ready={ready || sessionRef.current === null}
        talking={talking}
        onStart={handleStart}
        onStop={handleStop}
      />
    </main>
  );
}
```

- [ ] **Step 4: Verify the frontend builds**

Run: `cd voice-agent-webrtc-realtime/frontend && npm run build`
Expected: build succeeds, `/talk` route listed in the build output.

- [ ] **Step 5: Manual smoke test (requires real OpenAI key)**

Run from the sample root with a populated `.env`:
```bash
docker compose --env-file .env up --build
```
Then open `http://localhost:3000/talk?mode=emergency` in Chrome:
- Grant the microphone permission prompt.
- Hold the button, say "カルボナーラを2つ"; release.
- Expected: you hear the AI reply in the emergency-radio style; your line and the AI line appear in the 会話 transcript.
- Try `?mode=military` and `?mode=callcenter` — the page colors/fonts change and the AI persona changes.

If you cannot run this (no key), state so explicitly and rely on the `npm run build` result only.

- [ ] **Step 6: Commit**

```bash
git add voice-agent-webrtc-realtime/frontend/components/PushToTalk.tsx voice-agent-webrtc-realtime/frontend/components/Transcript.tsx voice-agent-webrtc-realtime/frontend/app/talk/page.tsx
git commit -m "feat(voice-agent): talk page with push-to-talk + live transcript"
```

---

## Task 11: Tool-call wiring + OrderReceipt

**Files:**
- Create: `voice-agent-webrtc-realtime/frontend/lib/tools.ts`
- Create: `voice-agent-webrtc-realtime/frontend/components/OrderReceipt.tsx`
- Modify: `voice-agent-webrtc-realtime/frontend/app/talk/page.tsx`

After this task, speaking an order updates the on-screen receipt instantly and writes through to Google Sheets.

- [ ] **Step 1: Create `frontend/lib/tools.ts`**

```typescript
import { sendEvent, type RealtimeSession } from "@/lib/realtime";
import type { Mode, Order, OrderItem } from "@/lib/types";

/** A receipt line as shown in OrderReceipt, with persistence state. */
export interface ReceiptOrder {
  order_id: string | null; // null until the backend assigns one
  items: OrderItem[];
  status: "pending" | "persisted" | "closed" | "error";
}

export interface ToolContext {
  mode: Mode;
  /** Optimistically update the receipt before the backend responds. */
  onOptimistic: (items: OrderItem[]) => void;
  /** Backend assigned/persisted an order id. */
  onPersisted: (order: Order) => void;
  onClosed: (order: Order) => void;
  onError: (message: string) => void;
}

interface FunctionCallEvent {
  type: string;
  name: string;
  call_id: string;
  arguments: string; // JSON string
}

function isFunctionCallDone(
  event: Record<string, unknown>,
): event is unknown as FunctionCallEvent {
  return event.type === "response.function_call_arguments.done";
}

/**
 * Handle a Realtime data-channel event. If it is a function call, execute it
 * against the backend HTTP API and return the result to the model via a
 * function_call_output item + response.create.
 *
 * Returns true if the event was a (handled) function call.
 */
export async function handleToolEvent(
  session: RealtimeSession,
  event: Record<string, unknown>,
  ctx: ToolContext,
): Promise<boolean> {
  if (!isFunctionCallDone(event)) return false;
  const call = event as FunctionCallEvent;
  const args = JSON.parse(call.arguments) as Record<string, unknown>;

  let output: Record<string, unknown>;
  try {
    output = await dispatch(call.name, args, ctx);
  } catch (err) {
    ctx.onError(String(err));
    output = { ok: false, error: String(err) };
  }

  sendEvent(session, {
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: call.call_id,
      output: JSON.stringify(output),
    },
  });
  sendEvent(session, { type: "response.create" });
  return true;
}

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  if (name === "add_order") {
    const items = args.items as OrderItem[];
    ctx.onOptimistic(items); // instant UI update, no Sheets round-trip
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: ctx.mode,
        customer_label: (args.customer_label as string) ?? null,
        language: args.language,
        items,
      }),
    });
    if (!res.ok) throw new Error(`add_order failed: ${res.status}`);
    const order = (await res.json()) as Order;
    ctx.onPersisted(order);
    return { ok: true, order_id: order.order_id };
  }

  if (name === "update_order") {
    const res = await fetch(`/api/orders/${args.order_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: args.items,
        notes: (args.notes as string) ?? null,
      }),
    });
    if (!res.ok) throw new Error(`update_order failed: ${res.status}`);
    const order = (await res.json()) as Order;
    ctx.onPersisted(order);
    return { ok: true, order_id: order.order_id };
  }

  if (name === "close_order") {
    const res = await fetch(`/api/orders/${args.order_id}/close`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`close_order failed: ${res.status}`);
    const order = (await res.json()) as Order;
    ctx.onClosed(order);
    return { ok: true, order_id: order.order_id, status: "closed" };
  }

  if (name === "list_orders") {
    const limit = (args.limit as number) ?? 10;
    const res = await fetch(`/api/orders/recent?limit=${limit}`);
    if (!res.ok) throw new Error(`list_orders failed: ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  throw new Error(`unknown tool: ${name}`);
}
```

Note: `is X as Y` is not valid TypeScript — replace the `isFunctionCallDone` guard with a plain boolean check. Use this corrected version of that function instead:

```typescript
function isFunctionCallDone(event: Record<string, unknown>): boolean {
  return event.type === "response.function_call_arguments.done";
}
```

And in `handleToolEvent`, change the first two lines to:

```typescript
  if (!isFunctionCallDone(event)) return false;
  const call = event as unknown as FunctionCallEvent;
```

- [ ] **Step 2: Create `frontend/components/OrderReceipt.tsx`**

```tsx
"use client";

import type { ReceiptOrder } from "@/lib/tools";

export function OrderReceipt({ order }: { order: ReceiptOrder | null }) {
  if (!order) {
    return (
      <section className="rounded-lg bg-black/20 p-4">
        <h2 className="mb-2 text-sm font-bold opacity-70">📝 ご注文</h2>
        <p className="text-sm opacity-40">まだ注文がありません</p>
      </section>
    );
  }

  const statusLabel = {
    pending: "保存中…",
    persisted: "✓ 記録済",
    closed: "✓ 確定済",
    error: "⚠️ 保存失敗、再試行中",
  }[order.status];

  return (
    <section className="rounded-lg bg-black/20 p-4">
      <h2 className="mb-2 text-sm font-bold opacity-70">📝 ご注文</h2>
      <ul className="flex flex-col gap-1">
        {order.items.map((item, idx) => (
          <li key={`${item.name}-${idx}`} className="flex justify-between text-sm">
            <span>
              {item.name}
              {item.note ? ` (${item.note})` : ""}
            </span>
            <span className="font-bold">× {item.qty}</span>
          </li>
        ))}
      </ul>
      <div
        className={`mt-2 text-right text-xs ${
          order.status === "error" ? "text-red-400" : "opacity-60"
        }`}
      >
        {statusLabel}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Modify `frontend/app/talk/page.tsx`** — wire the receipt and tool handler

Replace the entire file with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ModeBadge, MODE_STYLES } from "@/components/ModeTheme";
import { OrderReceipt } from "@/components/OrderReceipt";
import { PushToTalk } from "@/components/PushToTalk";
import { Transcript } from "@/components/Transcript";
import {
  closeRealtime,
  sendEvent,
  setMicEnabled,
  startRealtime,
  type RealtimeSession,
} from "@/lib/realtime";
import { handleToolEvent, type ReceiptOrder, type ToolContext } from "@/lib/tools";
import { isMode, type Mode, type TranscriptEntry } from "@/lib/types";

export default function TalkPage() {
  const params = useSearchParams();
  const rawMode = params.get("mode");
  const mode: Mode = isMode(rawMode) ? rawMode : "callcenter";
  const style = MODE_STYLES[mode];

  const sessionRef = useRef<RealtimeSession | null>(null);
  const [ready, setReady] = useState(false);
  const [talking, setTalking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [receipt, setReceipt] = useState<ReceiptOrder | null>(null);

  const toolCtx: ToolContext = {
    mode,
    onOptimistic: (items) =>
      setReceipt({ order_id: null, items, status: "pending" }),
    onPersisted: (order) =>
      setReceipt({
        order_id: order.order_id,
        items: order.items,
        status: "persisted",
      }),
    onClosed: (order) =>
      setReceipt({
        order_id: order.order_id,
        items: order.items,
        status: "closed",
      }),
    onError: () =>
      setReceipt((prev) => (prev ? { ...prev, status: "error" } : prev)),
  };

  function appendAssistantDelta(delta: string) {
    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && !last.done) {
        return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
      }
      return [
        ...prev,
        {
          id: `a-${Date.now()}-${Math.random()}`,
          role: "assistant",
          text: delta,
          done: false,
        },
      ];
    });
  }

  function handleEvent(event: Record<string, unknown>) {
    const type = event.type as string;

    if (type === "response.function_call_arguments.done") {
      const session = sessionRef.current;
      if (session) void handleToolEvent(session, event, toolCtx);
      return;
    }

    if (type === "response.audio_transcript.delta") {
      appendAssistantDelta(event.delta as string);
    } else if (type === "response.audio_transcript.done") {
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && !last.done) {
          return [...prev.slice(0, -1), { ...last, done: true }];
        }
        return prev;
      });
    } else if (
      type === "conversation.item.input_audio_transcription.completed"
    ) {
      setTranscript((prev) => [
        ...prev,
        {
          id: `u-${Date.now()}-${Math.random()}`,
          role: "user",
          text: event.transcript as string,
          done: true,
        },
      ]);
    }
  }

  async function handleStart() {
    setError(null);
    if (!sessionRef.current) {
      try {
        sessionRef.current = await startRealtime(mode, handleEvent);
        setReady(true);
      } catch (err) {
        setError(`接続に失敗しました: ${String(err)}`);
        return;
      }
    }
    setMicEnabled(sessionRef.current, true);
    setTalking(true);
  }

  function handleStop() {
    setTalking(false);
    const session = sessionRef.current;
    if (!session) return;
    setMicEnabled(session, false);
    sendEvent(session, { type: "input_audio_buffer.commit" });
    sendEvent(session, { type: "response.create" });
  }

  useEffect(() => {
    return () => {
      if (sessionRef.current) closeRealtime(sessionRef.current);
    };
  }, []);

  return (
    <main
      className={`min-h-screen p-4 flex flex-col gap-4 ${style.page} ${style.font}`}
    >
      <ModeBadge mode={mode} />
      {error && (
        <div className="rounded bg-black/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      <OrderReceipt order={receipt} />
      <Transcript entries={transcript} />
      <PushToTalk
        style={style}
        ready={ready || sessionRef.current === null}
        talking={talking}
        onStart={handleStart}
        onStop={handleStop}
      />
    </main>
  );
}
```

- [ ] **Step 4: Verify the frontend builds**

Run: `cd voice-agent-webrtc-realtime/frontend && npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 5: Manual smoke test (requires real OpenAI key + Sheets)**

With `docker compose --env-file .env up --build` running, open `http://localhost:3000/talk?mode=callcenter`:
- Order "親子丼を1つ"; release.
- Expected: the 📝 ご注文 receipt shows "親子丼 ×1" within ~1s with "保存中…", then "✓ 記録済"; a new row appears in the Google Sheet.
- Say "やっぱり2つにして" — the receipt qty updates to 2 and the same Sheet row updates.
- Say "以上で" — receipt shows "✓ 確定済", Sheet status column becomes `closed`.

If you cannot run this, state so and rely on `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add voice-agent-webrtc-realtime/frontend/lib/tools.ts voice-agent-webrtc-realtime/frontend/components/OrderReceipt.tsx voice-agent-webrtc-realtime/frontend/app/talk/page.tsx
git commit -m "feat(voice-agent): tool-call wiring + live OrderReceipt"
```

---

## Task 12: Events subscription + OrderTicker

**Files:**
- Create: `voice-agent-webrtc-realtime/frontend/lib/events.ts`
- Create: `voice-agent-webrtc-realtime/frontend/components/OrderTicker.tsx`
- Modify: `voice-agent-webrtc-realtime/frontend/app/talk/page.tsx`

- [ ] **Step 1: Create `frontend/lib/events.ts`**

```typescript
import type { TickerEvent } from "@/lib/types";

/**
 * Subscribe to the backend's /api/events WebSocket. Reconnects with backoff.
 * Returns a cleanup function that closes the socket and stops reconnecting.
 */
export function subscribeEvents(
  onEvent: (event: TickerEvent) => void,
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 1000;

  function connect() {
    if (closed) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${window.location.host}/api/events`);

    ws.addEventListener("open", () => {
      backoff = 1000;
    });
    ws.addEventListener("message", (e) => {
      onEvent(JSON.parse(e.data) as TickerEvent);
    });
    ws.addEventListener("close", () => {
      if (closed) return;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 15000);
    });
  }

  connect();

  return () => {
    closed = true;
    ws?.close();
  };
}
```

- [ ] **Step 2: Create `frontend/components/OrderTicker.tsx`**

```tsx
"use client";

import { MODE_STYLES } from "@/components/ModeTheme";
import type { Order } from "@/lib/types";

export function OrderTicker({ orders }: { orders: Order[] }) {
  return (
    <section className="rounded-lg bg-black/20 p-4">
      <h2 className="mb-2 text-sm font-bold opacity-70">📡 他のお客様 (ライブ)</h2>
      {orders.length === 0 ? (
        <p className="text-sm opacity-40">まだ他の注文はありません</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {orders.map((order) => (
            <li key={order.order_id} className="flex items-center gap-2 text-sm">
              <span>{MODE_STYLES[order.mode].emoji}</span>
              <span className="opacity-70">
                {order.customer_label || "お客様"}:
              </span>
              <span>
                {order.items.map((i) => `${i.name}×${i.qty}`).join(", ")}
              </span>
              {order.status === "closed" && (
                <span className="opacity-50">(確定)</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Modify `frontend/app/talk/page.tsx`** — subscribe to the ticker

Add these imports alongside the existing ones:

```tsx
import { OrderTicker } from "@/components/OrderTicker";
import { subscribeEvents } from "@/lib/events";
import { isMode, type Mode, type Order, type TranscriptEntry } from "@/lib/types";
```

(The last line replaces the existing `import { isMode, type Mode, type TranscriptEntry } from "@/lib/types";`.)

Add ticker state next to the other `useState` calls:

```tsx
  const [ticker, setTicker] = useState<Order[]>([]);
```

Replace the existing cleanup-only `useEffect` with one that also subscribes to events. The `order_id` of the current session's own order is filtered out so the ticker only shows *other* customers:

```tsx
  useEffect(() => {
    const unsubscribe = subscribeEvents((evt) => {
      setTicker((prev) => {
        const ownId = receiptRef.current?.order_id;
        if (evt.payload.order_id === ownId) return prev;
        const without = prev.filter(
          (o) => o.order_id !== evt.payload.order_id,
        );
        return [...without, evt.payload].slice(-20);
      });
    });
    return () => {
      unsubscribe();
      if (sessionRef.current) closeRealtime(sessionRef.current);
    };
  }, []);
```

Add a ref that mirrors `receipt` so the events callback can read the latest own-order id without re-subscribing. Place it next to `sessionRef`:

```tsx
  const receiptRef = useRef<ReceiptOrder | null>(null);
```

And keep it in sync — add this effect after the receipt state is declared:

```tsx
  useEffect(() => {
    receiptRef.current = receipt;
  }, [receipt]);
```

Finally, render the ticker — add it after `<Transcript ... />` in the returned JSX:

```tsx
      <OrderTicker orders={ticker} />
```

- [ ] **Step 4: Verify the frontend builds**

Run: `cd voice-agent-webrtc-realtime/frontend && npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 5: Manual smoke test (two browser tabs)**

With the stack running, open `/talk?mode=emergency` in tab A and `/talk?mode=callcenter` in tab B.
- Place an order in tab A.
- Expected: tab B's 📡 他のお客様 section shows tab A's order (with the 🚑 emoji); tab A does NOT show its own order in the ticker.

If you cannot run this, state so and rely on `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add voice-agent-webrtc-realtime/frontend/lib/events.ts voice-agent-webrtc-realtime/frontend/components/OrderTicker.tsx voice-agent-webrtc-realtime/frontend/app/talk/page.tsx
git commit -m "feat(voice-agent): events WebSocket subscription + OrderTicker"
```

---

## Task 13: QR landing page

**Files:**
- Modify: `voice-agent-webrtc-realtime/frontend/app/page.tsx`

- [ ] **Step 1: Replace `frontend/app/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { MODE_STYLES } from "@/components/ModeTheme";
import { MODES } from "@/lib/types";

export default function Home() {
  const [origin, setOrigin] = useState("");
  const [qrs, setQrs] = useState<Record<string, string>>({});

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        MODES.map(async (mode) => {
          const url = `${origin}/talk?mode=${mode}`;
          const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
          return [mode, dataUrl] as const;
        }),
      );
      if (!cancelled) setQrs(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [origin]);

  return (
    <main className="min-h-screen bg-neutral-950 p-8 text-white">
      <h1 className="mb-2 text-2xl font-bold">注文受付 AI — デモ</h1>
      <p className="mb-8 text-sm opacity-60">
        スマホで QR を撮って、好きな「通信プロトコル」で注文してみてください。
      </p>
      <div className="grid gap-8 sm:grid-cols-3">
        {MODES.map((mode) => {
          const style = MODE_STYLES[mode];
          return (
            <div
              key={mode}
              className="flex flex-col items-center gap-3 rounded-xl bg-neutral-900 p-6"
            >
              <div className="text-lg font-bold">
                {style.emoji} {style.label}
              </div>
              {qrs[mode] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrs[mode]}
                  alt={`${style.label} の QR コード`}
                  className="rounded bg-white p-2"
                  width={320}
                  height={320}
                />
              ) : (
                <div className="h-[320px] w-[320px] animate-pulse rounded bg-neutral-800" />
              )}
              <a
                href={`/talk?mode=${mode}`}
                className="text-sm underline opacity-70"
              >
                /talk?mode={mode}
              </a>
            </div>
          );
        })}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify the frontend builds**

Run: `cd voice-agent-webrtc-realtime/frontend && npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 3: Manual smoke test**

With the stack running, open `http://localhost:3000/` — three QR cards render (🚑/🪖/☎️). Scanning one (or clicking the link) opens the matching `/talk?mode=...` page.

If you cannot run this, state so and rely on `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add voice-agent-webrtc-realtime/frontend/app/page.tsx
git commit -m "feat(voice-agent): QR landing page for 3 modes"
```

---

## Task 14: Documentation

**Files:**
- Create: `voice-agent-webrtc-realtime/examples/sample-sheet.md`
- Create: `voice-agent-webrtc-realtime/examples/demo-script.md`
- Create: `voice-agent-webrtc-realtime/README.md`
- Modify: `README.md` (repo root — sample list table)

- [ ] **Step 1: Create `voice-agent-webrtc-realtime/examples/sample-sheet.md`**

````markdown
# Google Sheets セットアップ

## 1. シートを作成

新しいスプレッドシートを作り、1 枚目のシート名を `Orders` にする。
1 行目に以下のヘッダーを入れる:

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| order_id | created_at | mode | customer_label | items_json | language | status | notes |

## 2. サービスアカウントを作成

1. Google Cloud Console でプロジェクトを作成
2. 「IAM と管理」→「サービスアカウント」で新規作成
3. キーを JSON 形式で発行しダウンロード
4. Google Sheets API を有効化

## 3. シートを共有

ダウンロードした JSON の `client_email` の値(`...@....iam.gserviceaccount.com`)を、
スプレッドシートの「共有」で **編集者** として追加する。

## 4. 環境変数

- `SHEET_ID`: スプレッドシート URL の `/d/` と `/edit` の間の文字列
- `GOOGLE_APPLICATION_CREDENTIALS_JSON`: JSON ファイルの中身を **1 行に** して貼り付け

## 5. (任意) モード別の色分け

`C` 列(mode)に条件付き書式を設定するとデモ映えする:
- `emergency` → 赤背景
- `military` → 緑背景
- `callcenter` → 青背景
````

- [ ] **Step 2: Create `voice-agent-webrtc-realtime/examples/demo-script.md`**

````markdown
# デモ進行台本

## 準備

1. `.env` を用意し `docker compose --env-file .env up --build` で起動
2. `conoha app deploy` 済みなら `https://<your-fqdn>/` を開く
3. プロジェクターにトップページ(QR 3 枚)と Google Sheets を並べて表示

## 本番(5 分)

### 1. コールセンターモード(まずは普通)

- 観客に ☎️ の QR を撮ってもらう
- 進行役が代表で実演: 「親子丼を1つお願いします」→「以上で」
- Sheets に行が増えるのを見せる

### 2. 救急センターモード(笑いどころ)

- 🚑 の QR に切り替え
- 「カルボナーラ2つ」と頼むと「了解、現場到着予定20分、どうぞ」など
- 同じ業務なのに人格が違うことを強調

### 3. 作戦司令部モード

- 🪖 の QR
- 「ピザを1枚」→「通信補完、確認、送れ」

### 4. 多言語(オチ)

- どれかのモードのまま、英語や韓国語で話しかける
- 言語は切り替わるが通信プロトコル人格は維持されることを見せる

### 5. 同時体験

- 観客全員に好きな QR を撮ってもらう
- プロジェクターの Sheets と OrderTicker に全員の注文が流れ込む

## トラブルシュート

- マイクが使えない: ブラウザの権限を確認。iOS はボタンを押した瞬間に許可が出る
- 音が出ない: 端末のサイレントスイッチ / 音量
- 接続できない: `https` でアクセスしているか(WebRTC は TLS 必須)
````

- [ ] **Step 3: Create `voice-agent-webrtc-realtime/README.md`**

````markdown
# voice-agent-webrtc-realtime

ブラウザで QR を撮るだけで AI と音声会話ができ、会話の内容が Google Sheets に
リアルタイムで業務データとして書き込まれるデモサンプル。同じ「○○食堂の注文受付 AI」を
**3 つの通信プロトコル人格**(🚑 救急センター / 🪖 作戦司令部 / ☎️ コールセンター)で
切り替えられます。

電話番号も SIP トランクも不要 — 通信路は **WebRTC**、音声はブラウザと OpenAI Realtime API
を直結し、サーバーを経由しません。

## 構成

| レイヤー | 技術 |
|---|---|
| フロント | Next.js 16 (App Router, standalone) |
| バックエンド | FastAPI (Python 3.12) — ephemeral token 発行 + 注文 API + broadcast |
| 音声 AI | OpenAI Realtime API (`gpt-realtime-2`)、ブラウザ直結 WebRTC |
| 業務データ | Google Sheets (`google-api-python-client`) |

```
ブラウザ ──WebRTC(Opus)──► OpenAI Realtime API
   │  │ tool_call は DataChannel 経由でブラウザに届く
   │  └─► POST /api/orders ─► FastAPI ─► Google Sheets
   │                              └─► WS /api/events ─► 他のブラウザの OrderTicker
   └──► POST /api/realtime/session(ephemeral token 発行)
```

設計の詳細は
[`docs/superpowers/specs/2026-05-14-voice-agent-webrtc-realtime-design.md`](../docs/superpowers/specs/2026-05-14-voice-agent-webrtc-realtime-design.md)
を参照。

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) `>= v0.3.0`
- ConoHa VPS3 アカウント、SSH キーペア
- OpenAI API キー(Realtime API 利用可能な tier)
- Google サービスアカウントと共有済みスプレッドシート
  ([`examples/sample-sheet.md`](examples/sample-sheet.md) を参照)

## 環境変数

`.env.example` をコピーして `.env` を作成:

| 変数 | 説明 |
|---|---|
| `OPENAI_API_KEY` | OpenAI API キー |
| `OPENAI_REALTIME_MODEL` | 既定 `gpt-realtime-2` |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | サービスアカウント JSON を 1 行で |
| `SHEET_ID` | スプレッドシート ID |
| `RESTAURANT_NAME` | AI の挨拶に差し込む店名(例 `カフェ・コノハ`) |

## ローカル起動

```bash
cd voice-agent-webrtc-realtime
cp .env.example .env   # 値を埋める
docker compose --env-file .env up --build
```

- トップ(QR 一覧): http://localhost:3000/
- 通話画面: http://localhost:3000/talk?mode=emergency
- ヘルスチェック: http://localhost:8000/healthz

> WebRTC でマイクを使うため、`localhost` 以外で開く場合は HTTPS が必須です。

## デプロイ

```bash
# conoha.yml の hosts: を自分の FQDN に書き換える
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
conoha proxy boot --acme-email you@example.com myserver
conoha app init myserver
conoha app deploy myserver
```

`g2l-t-2 (2GB)` 推奨。

## 使い方

1. `https://<your-fqdn>/` を開くと 3 モードの QR が表示される
2. スマホで QR を撮ると `/talk?mode=...` が開く
3. 「🎤 PRESS TO TALK」を押しながら話す
4. 注文すると 📝 ご注文 にレシートが出て、Google Sheets に行が増える
5. デモ進行は [`examples/demo-script.md`](examples/demo-script.md) を参照

## テスト

バックエンドの HTTP API:

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest -v
```

フロントエンド・WebRTC・音声は実ブラウザでの手動確認です(`examples/demo-script.md`)。

## トラブルシュート

- **マイクが使えない**: iOS Safari は `getUserMedia` をボタン押下と同じ操作内でしか
  許可しません。本サンプルは PushToTalk の押下で初期化するので、ボタンを押してください。
- **音声が返ってこない**: 端末の音量・サイレントスイッチを確認。
- **`/api/realtime/session` が 503**: OpenAI のレート制限 / quota 超過。tier を確認。
- **Sheets に書き込まれない**: サービスアカウントをスプレッドシートに編集者として
  共有しているか、`SHEET_ID` が正しいかを確認。
- **OrderTicker が同期しない**: 本サンプルは bridge 単一インスタンス前提です。

## PSTN(電話)で受けたい場合

本サンプルは電話チャネルを扱いません。実電話番号で受けたい場合は、Twilio Elastic SIP
Trunking + Media Streams、Jambonz の自前ホスト、Twilio ConversationRelay などが
選択肢になります(設計書の Appendix を参照)。
````

- [ ] **Step 4: Modify the repo-root `README.md`** — register the sample

In the `## サンプル一覧` table, add this row immediately after the `slurm-rest-api` row:

```markdown
| [voice-agent-webrtc-realtime](voice-agent-webrtc-realtime/) | Next.js + FastAPI + OpenAI Realtime API | QR でアクセスしてブラウザで音声注文する AI エージェント（WebRTC 直結、3 つの通信プロトコル人格、Google Sheets 連携） | g2l-t-2 (2GB) |
```

- [ ] **Step 5: Verify the root README table is well-formed**

Run: `grep -n "voice-agent-webrtc-realtime" README.md`
Expected: one match in the sample list table.

- [ ] **Step 6: Commit**

```bash
git add voice-agent-webrtc-realtime/README.md voice-agent-webrtc-realtime/examples README.md
git commit -m "docs(voice-agent): sample README, demo script, sheet setup, root README registration"
```

---

## Self-Review

**1. Spec coverage:**

| Spec milestone | Task(s) |
|---|---|
| M1 two-service compose | Task 1 |
| M2 ephemeral token endpoint | Task 7 |
| M3 WebRTC client + DataChannel + push-to-talk | Tasks 9, 10 |
| M4 3 personas + ModeTheme | Tasks 2, 9 |
| M5 Tool Calling + Sheets | Tasks 3, 5, 7, 11 |
| M6 OrderReceipt + Transcript | Tasks 10, 11 |
| M7 WS broadcast + OrderTicker | Tasks 6, 8, 12 |
| M8 QR landing | Task 13 |
| M9 conoha.yml + deploy | Task 1 (conoha.yml); deploy is manual, documented in Task 14 README |
| M10 README + demo script + root README | Task 14 |
| M11 pytest suite | Tasks 2, 4, 7, 8 |

All spec API endpoints (`POST /api/realtime/session`, `POST/PATCH/POST-close/GET-recent /api/orders`, `WS /api/events`) are implemented in Tasks 7–8. All four tools (`add_order`, `update_order`, `close_order`, `list_orders`) are in the schema (Task 3) and dispatched (Task 11). Error-handling rows from the spec: token refresh + mic + 503 + ICE are handled in the frontend (Tasks 9–11) and documented (Task 14); Sheets 5xx → 502 + rollback is in Task 7 and tested; unknown `mode` fallback is in Task 2 and tested.

**2. Placeholder scan:** No "TBD"/"TODO"/"implement later". The one risky spot — the invalid TypeScript `is X as Y` in `tools.ts` Step 1 — is explicitly called out with a corrected replacement in the same step.

**3. Type consistency:** `RealtimeSession` (realtime.ts) is consumed by `tools.ts` and `talk/page.tsx` consistently. `ReceiptOrder` (tools.ts) is consumed by `OrderReceipt.tsx` and `talk/page.tsx`. `ToolContext` callbacks (`onOptimistic`/`onPersisted`/`onClosed`/`onError`) match between `tools.ts` definition and `talk/page.tsx` usage. Backend: `FakeSheets` in `conftest.py` matches `SheetsClient`'s `append_order`/`find_row`/`update_row` signatures. `order_to_row` is defined in `models.py` (Task 4) and used in `orders.py` (Task 7). Hub methods `history`/`publish`/`subscribe`/`unsubscribe` are defined in Task 6 and used in `events.py` (Task 8) and `orders.py` (Task 7).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-voice-agent-webrtc-realtime.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
