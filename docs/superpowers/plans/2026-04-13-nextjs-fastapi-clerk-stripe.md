# nextjs-fastapi-clerk-stripe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a SaaS sample app with Clerk authentication, Stripe subscription payments (sandbox), Next.js frontend, FastAPI backend, and PostgreSQL.

**Architecture:** Next.js 15 handles the frontend with Clerk SDK for auth. FastAPI serves as the backend API handling Stripe payments, Webhook processing, and JWT verification. PostgreSQL stores user and subscription data. All services run via Docker Compose.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 4, Clerk, FastAPI, SQLAlchemy (async), Stripe API, PostgreSQL 17, Docker

**Spec:** `docs/superpowers/specs/2026-04-13-nextjs-fastapi-clerk-stripe-design.md`

---

## File Structure

```
nextjs-fastapi-clerk-stripe/
├── compose.yml
├── .env.example
├── README.md
├── frontend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── postcss.config.mjs
│   ├── middleware.ts
│   ├── public/
│   │   └── .gitkeep
│   └── app/
│       ├── layout.tsx
│       ├── page.tsx
│       ├── globals.css
│       ├── pricing/
│       │   └── page.tsx
│       ├── dashboard/
│       │   └── page.tsx
│       ├── sign-in/[[...sign-in]]/
│       │   └── page.tsx
│       ├── sign-up/[[...sign-up]]/
│       │   └── page.tsx
│       └── lib/
│           └── api.ts
└── backend/
    ├── Dockerfile
    ├── .dockerignore
    ├── requirements.txt
    └── app/
        ├── main.py
        ├── config.py
        ├── database.py
        ├── models.py
        ├── auth.py
        ├── routers/
        │   ├── checkout.py
        │   ├── subscription.py
        │   └── webhooks.py
        └── services/
            └── stripe_service.py
```

---

### Task 1: Project scaffolding — compose.yml, Dockerfiles, config files

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/compose.yml`
- Create: `nextjs-fastapi-clerk-stripe/.env.example`
- Create: `nextjs-fastapi-clerk-stripe/backend/Dockerfile`
- Create: `nextjs-fastapi-clerk-stripe/backend/.dockerignore`
- Create: `nextjs-fastapi-clerk-stripe/backend/requirements.txt`
- Create: `nextjs-fastapi-clerk-stripe/frontend/Dockerfile`
- Create: `nextjs-fastapi-clerk-stripe/frontend/.dockerignore`
- Create: `nextjs-fastapi-clerk-stripe/frontend/public/.gitkeep`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p nextjs-fastapi-clerk-stripe/{frontend/{public,app/{pricing,dashboard,"sign-in/[[...sign-in]]","sign-up/[[...sign-up]]",lib,components}},backend/app/{routers,services}}
touch nextjs-fastapi-clerk-stripe/frontend/public/.gitkeep
```

- [ ] **Step 2: Create compose.yml**

Create `nextjs-fastapi-clerk-stripe/compose.yml`:

```yaml
services:
  frontend:
    build: ./frontend
    ports:
      - "80:3000"
    environment:
      - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      - CLERK_SECRET_KEY=${CLERK_SECRET_KEY}
      - NEXT_PUBLIC_API_URL=http://localhost/api
    depends_on:
      backend:
        condition: service_healthy

  backend:
    build: ./backend
    expose:
      - "8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://appuser:apppass@db:5432/appdb
      - STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
      - STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
      - CLERK_WEBHOOK_SECRET=${CLERK_WEBHOOK_SECRET}
      - CLERK_JWKS_URL=${CLERK_JWKS_URL}
      - STRIPE_PRO_PRICE_ID=${STRIPE_PRO_PRICE_ID}
      - STRIPE_ENTERPRISE_PRICE_ID=${STRIPE_ENTERPRISE_PRICE_ID}
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"]
      interval: 5s
      timeout: 5s
      retries: 5

  db:
    image: postgres:17
    environment:
      - POSTGRES_DB=appdb
      - POSTGRES_USER=appuser
      - POSTGRES_PASSWORD=apppass
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U appuser -d appdb"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  db_data:
```

- [ ] **Step 3: Create .env.example**

Create `nextjs-fastapi-clerk-stripe/.env.example`:

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
CLERK_SECRET_KEY=sk_test_xxxxx
CLERK_WEBHOOK_SECRET=whsec_xxxxx
CLERK_JWKS_URL=https://your-clerk-app.clerk.accounts.dev/.well-known/jwks.json

# Stripe
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRO_PRICE_ID=price_xxxxx
STRIPE_ENTERPRISE_PRICE_ID=price_xxxxx
```

- [ ] **Step 4: Create backend/requirements.txt**

Create `nextjs-fastapi-clerk-stripe/backend/requirements.txt`:

```
fastapi==0.115.12
uvicorn[standard]==0.34.2
sqlalchemy[asyncio]==2.0.40
asyncpg==0.31.0
pydantic==2.11.3
pydantic-settings==2.9.1
stripe==12.2.0
PyJWT[crypto]==2.10.1
httpx==0.28.1
svix==1.62.0
```

- [ ] **Step 5: Create backend/Dockerfile**

Create `nextjs-fastapi-clerk-stripe/backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 6: Create backend/.dockerignore**

Create `nextjs-fastapi-clerk-stripe/backend/.dockerignore`:

```
__pycache__
*.pyc
.venv
```

- [ ] **Step 7: Create frontend/Dockerfile**

Create `nextjs-fastapi-clerk-stripe/frontend/Dockerfile`:

```dockerfile
# Stage 1: Install dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build the application
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: Production runner
FROM node:22-alpine AS runner
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

- [ ] **Step 8: Create frontend/.dockerignore**

Create `nextjs-fastapi-clerk-stripe/frontend/.dockerignore`:

```
node_modules
.next
```

- [ ] **Step 9: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/
git commit -m "feat(nextjs-fastapi-clerk-stripe): scaffold project structure"
```

---

### Task 2: Backend — database models and config

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/backend/app/config.py`
- Create: `nextjs-fastapi-clerk-stripe/backend/app/database.py`
- Create: `nextjs-fastapi-clerk-stripe/backend/app/models.py`

- [ ] **Step 1: Create config.py**

Create `nextjs-fastapi-clerk-stripe/backend/app/config.py`:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://appuser:apppass@localhost:5432/appdb"
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_pro_price_id: str = ""
    stripe_enterprise_price_id: str = ""
    clerk_webhook_secret: str = ""
    clerk_jwks_url: str = ""


settings = Settings()
```

- [ ] **Step 2: Create database.py**

Create `nextjs-fastapi-clerk-stripe/backend/app/database.py`:

```python
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(settings.database_url)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db():
    async with async_session() as session:
        yield session
```

- [ ] **Step 3: Create models.py**

Create `nextjs-fastapi-clerk-stripe/backend/app/models.py`:

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    clerk_user_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    email: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    stripe_subscription_id: Mapped[str] = mapped_column(String(255), unique=True)
    stripe_price_id: Mapped[str] = mapped_column(String(255))
    plan: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(50))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
```

- [ ] **Step 4: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/backend/app/
git commit -m "feat(nextjs-fastapi-clerk-stripe): add backend database models and config"
```

---

### Task 3: Backend — Clerk JWT authentication

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/backend/app/auth.py`

- [ ] **Step 1: Create auth.py**

Create `nextjs-fastapi-clerk-stripe/backend/app/auth.py`:

```python
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User

security = HTTPBearer()

_jwk_client: PyJWKClient | None = None


def get_jwk_client() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = PyJWKClient(settings.clerk_jwks_url, cache_keys=True)
    return _jwk_client


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials
    try:
        jwk_client = get_jwk_client()
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
        )
    except jwt.PyJWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        )

    clerk_user_id = payload.get("sub")
    if not clerk_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing sub claim",
        )

    result = await db.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return user
```

- [ ] **Step 2: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/backend/app/auth.py
git commit -m "feat(nextjs-fastapi-clerk-stripe): add Clerk JWT authentication"
```

---

### Task 4: Backend — Stripe service

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/backend/app/services/stripe_service.py`

- [ ] **Step 1: Create stripe_service.py**

Create `nextjs-fastapi-clerk-stripe/backend/app/services/stripe_service.py`:

```python
import stripe

from app.config import settings

stripe.api_key = settings.stripe_secret_key

PRICE_TO_PLAN: dict[str, str] = {}


def init_price_to_plan() -> None:
    if settings.stripe_pro_price_id:
        PRICE_TO_PLAN[settings.stripe_pro_price_id] = "pro"
    if settings.stripe_enterprise_price_id:
        PRICE_TO_PLAN[settings.stripe_enterprise_price_id] = "enterprise"


def create_customer(email: str, clerk_user_id: str) -> stripe.Customer:
    return stripe.Customer.create(
        email=email,
        metadata={"clerk_user_id": clerk_user_id},
    )


def create_checkout_session(
    customer_id: str,
    price_id: str,
    success_url: str,
    cancel_url: str,
) -> stripe.checkout.Session:
    return stripe.checkout.Session.create(
        customer=customer_id,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=success_url,
        cancel_url=cancel_url,
        locale="ja",
    )


def create_portal_session(customer_id: str, return_url: str) -> stripe.billing_portal.Session:
    return stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )


def construct_webhook_event(payload: bytes, sig_header: str) -> stripe.Event:
    return stripe.Webhook.construct_event(
        payload, sig_header, settings.stripe_webhook_secret
    )


def get_plan_from_price(price_id: str) -> str:
    return PRICE_TO_PLAN.get(price_id, "unknown")
```

- [ ] **Step 2: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/backend/app/services/
git commit -m "feat(nextjs-fastapi-clerk-stripe): add Stripe service layer"
```

---

### Task 5: Backend — Webhook handlers (Clerk + Stripe)

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/backend/app/routers/webhooks.py`

- [ ] **Step 1: Create webhooks.py**

Create `nextjs-fastapi-clerk-stripe/backend/app/routers/webhooks.py`:

```python
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from svix.webhooks import Webhook, WebhookVerificationError

from app.config import settings
from app.database import get_db
from app.models import Subscription, User
from app.services.stripe_service import construct_webhook_event, create_customer, get_plan_from_price

router = APIRouter()


@router.post("/api/webhooks/clerk")
async def clerk_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    body = await request.body()
    headers = {
        "svix-id": request.headers.get("svix-id", ""),
        "svix-timestamp": request.headers.get("svix-timestamp", ""),
        "svix-signature": request.headers.get("svix-signature", ""),
    }

    try:
        wh = Webhook(settings.clerk_webhook_secret)
        event = wh.verify(body, headers)
    except WebhookVerificationError:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    if event["type"] == "user.created":
        data = event["data"]
        clerk_user_id = data["id"]
        email = ""
        if data.get("email_addresses"):
            email = data["email_addresses"][0].get("email_address", "")

        existing = await db.execute(
            select(User).where(User.clerk_user_id == clerk_user_id)
        )
        if existing.scalar_one_or_none():
            return {"status": "already exists"}

        customer = create_customer(email=email, clerk_user_id=clerk_user_id)

        user = User(
            clerk_user_id=clerk_user_id,
            stripe_customer_id=customer.id,
            email=email,
        )
        db.add(user)
        await db.commit()

    return {"status": "ok"}


@router.post("/api/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(alias="stripe-signature"),
    db: AsyncSession = Depends(get_db),
):
    payload = await request.body()

    try:
        event = construct_webhook_event(payload, stripe_signature)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        customer_id = session["customer"]
        subscription_id = session["subscription"]

        result = await db.execute(
            select(User).where(User.stripe_customer_id == customer_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            return {"status": "user not found"}

        sub = await _fetch_and_save_subscription(db, user, subscription_id)

    elif event["type"] in (
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        sub_data = event["data"]["object"]
        subscription_id = sub_data["id"]

        result = await db.execute(
            select(Subscription).where(
                Subscription.stripe_subscription_id == subscription_id
            )
        )
        existing_sub = result.scalar_one_or_none()
        if existing_sub:
            price_id = sub_data["items"]["data"][0]["price"]["id"]
            existing_sub.stripe_price_id = price_id
            existing_sub.plan = get_plan_from_price(price_id)
            existing_sub.status = sub_data["status"]
            if sub_data.get("current_period_end"):
                existing_sub.current_period_end = datetime.fromtimestamp(
                    sub_data["current_period_end"], tz=timezone.utc
                )
            await db.commit()

    return {"status": "ok"}


async def _fetch_and_save_subscription(
    db: AsyncSession, user: User, subscription_id: str
) -> Subscription:
    import stripe

    sub_data = stripe.Subscription.retrieve(subscription_id)
    price_id = sub_data["items"]["data"][0]["price"]["id"]

    current_period_end = None
    if sub_data.get("current_period_end"):
        current_period_end = datetime.fromtimestamp(
            sub_data["current_period_end"], tz=timezone.utc
        )

    sub = Subscription(
        user_id=user.id,
        stripe_subscription_id=subscription_id,
        stripe_price_id=price_id,
        plan=get_plan_from_price(price_id),
        status=sub_data["status"],
        current_period_end=current_period_end,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub
```

- [ ] **Step 2: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/backend/app/routers/webhooks.py
git commit -m "feat(nextjs-fastapi-clerk-stripe): add Clerk and Stripe webhook handlers"
```

---

### Task 6: Backend — Checkout, Portal, Subscription endpoints

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/backend/app/routers/checkout.py`
- Create: `nextjs-fastapi-clerk-stripe/backend/app/routers/subscription.py`

- [ ] **Step 1: Create checkout.py**

Create `nextjs-fastapi-clerk-stripe/backend/app/routers/checkout.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user
from app.models import User
from app.services.stripe_service import create_checkout_session, create_portal_session

router = APIRouter()


class CheckoutRequest(BaseModel):
    price_id: str
    success_url: str
    cancel_url: str


class PortalRequest(BaseModel):
    return_url: str


@router.post("/api/checkout")
async def checkout(
    body: CheckoutRequest,
    user: User = Depends(get_current_user),
):
    if not user.stripe_customer_id:
        raise HTTPException(status_code=400, detail="Stripe customer not found")

    session = create_checkout_session(
        customer_id=user.stripe_customer_id,
        price_id=body.price_id,
        success_url=body.success_url,
        cancel_url=body.cancel_url,
    )
    return {"url": session.url}


@router.post("/api/portal")
async def portal(
    body: PortalRequest,
    user: User = Depends(get_current_user),
):
    if not user.stripe_customer_id:
        raise HTTPException(status_code=400, detail="Stripe customer not found")

    session = create_portal_session(
        customer_id=user.stripe_customer_id,
        return_url=body.return_url,
    )
    return {"url": session.url}
```

- [ ] **Step 2: Create subscription.py**

Create `nextjs-fastapi-clerk-stripe/backend/app/routers/subscription.py`:

```python
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Subscription, User

router = APIRouter()


@router.get("/api/subscription")
async def get_subscription(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user.id)
        .where(Subscription.status.in_(["active", "trialing", "past_due"]))
        .order_by(Subscription.created_at.desc())
        .limit(1)
    )
    sub = result.scalar_one_or_none()

    if not sub:
        return {
            "plan": "free",
            "status": "active",
            "current_period_end": None,
        }

    return {
        "plan": sub.plan,
        "status": sub.status,
        "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
    }
```

- [ ] **Step 3: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/backend/app/routers/
git commit -m "feat(nextjs-fastapi-clerk-stripe): add checkout, portal, and subscription endpoints"
```

---

### Task 7: Backend — main.py (FastAPI app with lifespan)

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/backend/app/main.py`

- [ ] **Step 1: Create main.py**

Create `nextjs-fastapi-clerk-stripe/backend/app/main.py`:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.database import engine
from app.models import Base
from app.routers import checkout, subscription, webhooks
from app.services.stripe_service import init_price_to_plan


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    init_price_to_plan()
    yield


app = FastAPI(lifespan=lifespan)

app.include_router(webhooks.router)
app.include_router(checkout.router)
app.include_router(subscription.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 2: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/backend/app/main.py
git commit -m "feat(nextjs-fastapi-clerk-stripe): add FastAPI app entrypoint"
```

---

### Task 8: Frontend — project configuration files

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/frontend/package.json`
- Create: `nextjs-fastapi-clerk-stripe/frontend/next.config.ts`
- Create: `nextjs-fastapi-clerk-stripe/frontend/tsconfig.json`
- Create: `nextjs-fastapi-clerk-stripe/frontend/postcss.config.mjs`

- [ ] **Step 1: Create package.json**

Create `nextjs-fastapi-clerk-stripe/frontend/package.json`:

```json
{
  "name": "nextjs-fastapi-clerk-stripe",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@clerk/nextjs": "^6.12.0",
    "next": "15.3.1",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.4",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.1.4",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create next.config.ts**

Create `nextjs-fastapi-clerk-stripe/frontend/next.config.ts`:

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

- [ ] **Step 3: Create tsconfig.json**

Create `nextjs-fastapi-clerk-stripe/frontend/tsconfig.json`:

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

- [ ] **Step 4: Create postcss.config.mjs**

Create `nextjs-fastapi-clerk-stripe/frontend/postcss.config.mjs`:

```javascript
/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 5: Run npm install to generate package-lock.json**

```bash
cd nextjs-fastapi-clerk-stripe/frontend && npm install && cd ../..
```

- [ ] **Step 6: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/frontend/package.json nextjs-fastapi-clerk-stripe/frontend/package-lock.json nextjs-fastapi-clerk-stripe/frontend/next.config.ts nextjs-fastapi-clerk-stripe/frontend/tsconfig.json nextjs-fastapi-clerk-stripe/frontend/postcss.config.mjs
git commit -m "feat(nextjs-fastapi-clerk-stripe): add frontend configuration files"
```

---

### Task 9: Frontend — globals.css, layout, Clerk middleware

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/frontend/app/globals.css`
- Create: `nextjs-fastapi-clerk-stripe/frontend/app/layout.tsx`
- Create: `nextjs-fastapi-clerk-stripe/frontend/middleware.ts`

- [ ] **Step 1: Create globals.css**

Create `nextjs-fastapi-clerk-stripe/frontend/app/globals.css`:

```css
@import "tailwindcss";

@theme {
  --color-primary: #6c5ce7;
  --color-primary-dark: #5a4bd1;
  --color-primary-light: #f0edfc;
  --color-accent: #00b894;
  --color-accent-dark: #00a381;
  --color-gray-50: #f9fafb;
  --color-gray-100: #f3f4f6;
  --color-gray-200: #e5e7eb;
  --color-gray-300: #d1d5db;
  --color-gray-400: #9ca3af;
  --color-gray-500: #6b7280;
  --color-gray-600: #4b5563;
  --color-gray-700: #374151;
  --color-gray-800: #1f2937;
  --color-gray-900: #111827;
}

html {
  scroll-behavior: smooth;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 2: Create layout.tsx**

Create `nextjs-fastapi-clerk-stripe/frontend/app/layout.tsx`:

```tsx
import { ClerkProvider, SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { jaJP } from "@clerk/localizations";
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SaaS Demo - Clerk + Stripe",
  description: "Clerk認証とStripe決済のSaaSデモアプリ",
};

function Header() {
  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-primary">
          SaaS Demo
        </Link>
        <nav className="flex items-center gap-6">
          <Link href="/pricing" className="text-gray-600 hover:text-gray-900">
            料金プラン
          </Link>
          <SignedIn>
            <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
              ダッシュボード
            </Link>
            <UserButton />
          </SignedIn>
          <SignedOut>
            <Link
              href="/sign-in"
              className="text-gray-600 hover:text-gray-900"
            >
              ログイン
            </Link>
            <Link
              href="/sign-up"
              className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-dark"
            >
              無料で始める
            </Link>
          </SignedOut>
        </nav>
      </div>
    </header>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider localization={jaJP}>
      <html lang="ja">
        <body className="min-h-screen flex flex-col bg-gray-50">
          <Header />
          <main className="flex-1">{children}</main>
          <footer className="bg-gray-900 text-gray-400 text-center py-6 text-sm">
            SaaS Demo &middot; Deployed with conoha app deploy
          </footer>
        </body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 3: Create middleware.ts**

Create `nextjs-fastapi-clerk-stripe/frontend/middleware.ts`:

```typescript
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
```

- [ ] **Step 4: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/frontend/app/globals.css nextjs-fastapi-clerk-stripe/frontend/app/layout.tsx nextjs-fastapi-clerk-stripe/frontend/middleware.ts
git commit -m "feat(nextjs-fastapi-clerk-stripe): add layout, globals, and Clerk middleware"
```

---

### Task 10: Frontend — API utility with JWT

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/frontend/app/lib/api.ts`

- [ ] **Step 1: Create api.ts**

Create `nextjs-fastapi-clerk-stripe/frontend/app/lib/api.ts`:

```typescript
import { auth } from "@clerk/nextjs/server";

const API_BASE = "http://backend:8000/api";

async function fetchWithAuth(path: string, options: RequestInit = {}) {
  const { getToken } = await auth();
  const token = await getToken();

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json();
}

export async function getSubscription() {
  return fetchWithAuth("/subscription");
}

export async function createCheckoutSession(priceId: string, successUrl: string, cancelUrl: string) {
  return fetchWithAuth("/checkout", {
    method: "POST",
    body: JSON.stringify({
      price_id: priceId,
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
  });
}

export async function createPortalSession(returnUrl: string) {
  return fetchWithAuth("/portal", {
    method: "POST",
    body: JSON.stringify({ return_url: returnUrl }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/frontend/app/lib/api.ts
git commit -m "feat(nextjs-fastapi-clerk-stripe): add API utility with Clerk JWT"
```

---

### Task 11: Frontend — Landing page

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/frontend/app/page.tsx`

- [ ] **Step 1: Create page.tsx**

Create `nextjs-fastapi-clerk-stripe/frontend/app/page.tsx`:

```tsx
import Link from "next/link";

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary to-primary-dark text-white py-24">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl font-bold mb-4">
            ビジネスを加速する SaaS プラットフォーム
          </h1>
          <p className="text-lg text-white/80 mb-8">
            Clerk 認証と Stripe 決済を統合した、モダンな SaaS アプリケーションのデモです。
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href="/sign-up"
              className="bg-white text-primary font-semibold px-6 py-3 rounded-lg hover:bg-gray-100"
            >
              無料で始める
            </Link>
            <Link
              href="/pricing"
              className="border border-white/40 text-white font-semibold px-6 py-3 rounded-lg hover:bg-white/10"
            >
              料金プランを見る
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-center mb-12">主な機能</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <div className="text-3xl mb-4">🔐</div>
              <h3 className="text-lg font-semibold mb-2">セキュアな認証</h3>
              <p className="text-gray-600">
                Clerk による安全なログイン・会員登録。ソーシャルログインにも対応。
              </p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <div className="text-3xl mb-4">💳</div>
              <h3 className="text-lg font-semibold mb-2">簡単な決済</h3>
              <p className="text-gray-600">
                Stripe Checkout による安全な決済。日本円でのサブスクリプション管理。
              </p>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <div className="text-3xl mb-4">🚀</div>
              <h3 className="text-lg font-semibold mb-2">即座にデプロイ</h3>
              <p className="text-gray-600">
                conoha app deploy でワンコマンドデプロイ。Docker Compose で簡単運用。
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/frontend/app/page.tsx
git commit -m "feat(nextjs-fastapi-clerk-stripe): add landing page"
```

---

### Task 12: Frontend — Pricing page

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/frontend/app/pricing/page.tsx`

- [ ] **Step 1: Create pricing page.tsx**

Create `nextjs-fastapi-clerk-stripe/frontend/app/pricing/page.tsx`:

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createCheckoutSession, getSubscription } from "../lib/api";

const plans = [
  {
    name: "Free",
    price: "¥0",
    period: "月",
    description: "個人利用に最適",
    features: ["基本機能", "メールサポート", "1 プロジェクト"],
    priceId: null,
  },
  {
    name: "Pro",
    price: "¥980",
    period: "月",
    description: "プロフェッショナル向け",
    features: ["全機能", "優先サポート", "無制限プロジェクト", "API アクセス"],
    priceId: process.env.STRIPE_PRO_PRICE_ID || "",
    popular: true,
  },
  {
    name: "Enterprise",
    price: "¥4,980",
    period: "月",
    description: "チーム・企業向け",
    features: [
      "全機能",
      "専用サポート",
      "無制限プロジェクト",
      "API アクセス",
      "チーム管理",
      "SLA 保証",
    ],
    priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || "",
  },
];

export default async function PricingPage() {
  const { userId } = await auth();

  let currentPlan = "free";
  if (userId) {
    try {
      const sub = await getSubscription();
      currentPlan = sub.plan;
    } catch {
      // not subscribed
    }
  }

  async function subscribe(formData: FormData) {
    "use server";
    const priceId = formData.get("priceId") as string;
    const { userId: uid } = await auth();
    if (!uid) redirect("/sign-in");

    const result = await createCheckoutSession(
      priceId,
      `${process.env.NEXT_PUBLIC_API_URL?.replace("/api", "")}/dashboard?success=true`,
      `${process.env.NEXT_PUBLIC_API_URL?.replace("/api", "")}/pricing`,
    );
    redirect(result.url);
  }

  return (
    <section className="py-20">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-center mb-4">料金プラン</h1>
        <p className="text-gray-600 text-center mb-12">
          ビジネスの規模に合わせて最適なプランをお選びください
        </p>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`bg-white rounded-xl p-8 shadow-sm relative ${
                plan.popular ? "ring-2 ring-primary" : ""
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white text-xs px-3 py-1 rounded-full">
                  人気
                </span>
              )}
              <h2 className="text-xl font-bold mb-2">{plan.name}</h2>
              <p className="text-gray-500 text-sm mb-4">{plan.description}</p>
              <div className="mb-6">
                <span className="text-4xl font-bold">{plan.price}</span>
                <span className="text-gray-500">/{plan.period}</span>
              </div>
              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <span className="text-accent">&#10003;</span>
                    {feature}
                  </li>
                ))}
              </ul>
              {plan.name.toLowerCase() === currentPlan ? (
                <div className="w-full text-center py-3 rounded-lg bg-gray-100 text-gray-500 font-semibold">
                  現在のプラン
                </div>
              ) : plan.priceId && userId ? (
                <form action={subscribe}>
                  <input type="hidden" name="priceId" value={plan.priceId} />
                  <button
                    type="submit"
                    className="w-full bg-primary text-white py-3 rounded-lg font-semibold hover:bg-primary-dark"
                  >
                    このプランを選択
                  </button>
                </form>
              ) : !plan.priceId ? (
                <div className="w-full text-center py-3 rounded-lg bg-gray-100 text-gray-500 font-semibold">
                  {currentPlan === "free" ? "現在のプラン" : "ダウングレード不可"}
                </div>
              ) : (
                <a
                  href="/sign-up"
                  className="block w-full text-center bg-primary text-white py-3 rounded-lg font-semibold hover:bg-primary-dark"
                >
                  無料で始める
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/frontend/app/pricing/
git commit -m "feat(nextjs-fastapi-clerk-stripe): add pricing page with Stripe checkout"
```

---

### Task 13: Frontend — Dashboard page

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/frontend/app/dashboard/page.tsx`

- [ ] **Step 1: Create dashboard page.tsx**

Create `nextjs-fastapi-clerk-stripe/frontend/app/dashboard/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createPortalSession, getSubscription } from "../lib/api";

const planLabels: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  enterprise: "Enterprise",
};

const statusLabels: Record<string, string> = {
  active: "有効",
  trialing: "トライアル中",
  past_due: "支払い遅延",
  canceled: "解約済み",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const params = await searchParams;
  const sub = await getSubscription();

  async function manageSubscription() {
    "use server";
    const result = await createPortalSession(
      `${process.env.NEXT_PUBLIC_API_URL?.replace("/api", "")}/dashboard`
    );
    redirect(result.url);
  }

  return (
    <section className="py-12">
      <div className="max-w-2xl mx-auto px-4">
        <h1 className="text-2xl font-bold mb-8">ダッシュボード</h1>

        {params.success && (
          <div className="bg-accent/10 text-accent-dark border border-accent/20 rounded-lg p-4 mb-6">
            サブスクリプションの登録が完了しました！
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm p-8">
          <h2 className="text-lg font-semibold mb-6">サブスクリプション情報</h2>

          <div className="space-y-4">
            <div className="flex justify-between items-center py-3 border-b border-gray-100">
              <span className="text-gray-500">現在のプラン</span>
              <span className="font-semibold text-lg">
                {planLabels[sub.plan] || sub.plan}
              </span>
            </div>

            <div className="flex justify-between items-center py-3 border-b border-gray-100">
              <span className="text-gray-500">ステータス</span>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  sub.status === "active"
                    ? "bg-accent/10 text-accent-dark"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {statusLabels[sub.status] || sub.status}
              </span>
            </div>

            {sub.current_period_end && (
              <div className="flex justify-between items-center py-3 border-b border-gray-100">
                <span className="text-gray-500">次回請求日</span>
                <span>
                  {new Date(sub.current_period_end).toLocaleDateString("ja-JP")}
                </span>
              </div>
            )}
          </div>

          <div className="mt-8 flex gap-4">
            {sub.plan === "free" ? (
              <a
                href="/pricing"
                className="bg-primary text-white px-6 py-3 rounded-lg font-semibold hover:bg-primary-dark"
              >
                プランをアップグレード
              </a>
            ) : (
              <form action={manageSubscription}>
                <button
                  type="submit"
                  className="bg-gray-800 text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-900"
                >
                  サブスクリプション管理
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/frontend/app/dashboard/
git commit -m "feat(nextjs-fastapi-clerk-stripe): add dashboard page"
```

---

### Task 14: Frontend — Sign-in / Sign-up pages

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/frontend/app/sign-in/[[...sign-in]]/page.tsx`
- Create: `nextjs-fastapi-clerk-stripe/frontend/app/sign-up/[[...sign-up]]/page.tsx`

- [ ] **Step 1: Create sign-in page**

Create `nextjs-fastapi-clerk-stripe/frontend/app/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex justify-center py-20">
      <SignIn />
    </div>
  );
}
```

- [ ] **Step 2: Create sign-up page**

Create `nextjs-fastapi-clerk-stripe/frontend/app/sign-up/[[...sign-up]]/page.tsx`:

```tsx
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex justify-center py-20">
      <SignUp />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/frontend/app/sign-in/ nextjs-fastapi-clerk-stripe/frontend/app/sign-up/
git commit -m "feat(nextjs-fastapi-clerk-stripe): add Clerk sign-in and sign-up pages"
```

---

### Task 15: README and registration in root README

**Files:**
- Create: `nextjs-fastapi-clerk-stripe/README.md`
- Modify: `README.md` (root — add new sample to the table)

- [ ] **Step 1: Create README.md**

Create `nextjs-fastapi-clerk-stripe/README.md`:

```markdown
# nextjs-fastapi-clerk-stripe

Clerk 認証 + Stripe サブスクリプション決済の SaaS デモアプリです。Next.js フロントエンド + FastAPI バックエンド + PostgreSQL の構成で、料金プラン選択から Stripe Checkout での決済、Customer Portal でのサブスクリプション管理までの一連のフローを実装しています。

## 構成

- Next.js 15 (App Router, standalone) — フロントエンド + Clerk 認証
- FastAPI — バックエンド API + Stripe 連携 + Webhook 処理
- PostgreSQL 17 — ユーザー・サブスクリプションデータ
- Clerk — 認証・ユーザー管理
- Stripe (sandbox) — サブスクリプション決済
- ポート: 80

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- [Clerk](https://clerk.com) アカウント
- [Stripe](https://stripe.com) アカウント（テストモード）

## セットアップ

### 1. Clerk の設定

1. [Clerk Dashboard](https://dashboard.clerk.com) でアプリケーションを作成
2. Publishable Key と Secret Key をメモ
3. Webhooks 設定で以下を追加:
   - エンドポイント URL: `http://<サーバーIP>/api/webhooks/clerk`
   - イベント: `user.created`
   - Signing Secret をメモ
4. JWKS URL をメモ（`https://<your-app>.clerk.accounts.dev/.well-known/jwks.json`）

### 2. Stripe の設定

1. [Stripe Dashboard](https://dashboard.stripe.com/test) でテストモードを確認
2. Product を 2 つ作成:
   - **Pro**: ¥980/月（recurring, JPY）
   - **Enterprise**: ¥4,980/月（recurring, JPY）
3. 各 Product の Price ID をメモ（`price_xxxxx`）
4. Webhooks 設定で以下を追加:
   - エンドポイント URL: `http://<サーバーIP>/api/webhooks/stripe`
   - イベント: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Webhook Signing Secret をメモ
5. Customer Portal を有効化:
   - [設定](https://dashboard.stripe.com/test/settings/billing/portal) でサブスクリプションの変更・解約を許可

### 3. 環境変数の設定

```bash
cp .env.example .env
# .env を編集して各キーを設定
```

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name nextjs-fastapi-clerk-stripe

# デプロイ
conoha app deploy myserver --app-name nextjs-fastapi-clerk-stripe
```

## 動作確認

1. ブラウザで `http://<サーバーIP>` にアクセス
2. 「無料で始める」から会員登録
3. 料金プランページで Pro または Enterprise を選択
4. Stripe Checkout で決済（テストカード: `4242 4242 4242 4242`）
5. ダッシュボードでサブスクリプション状態を確認
6. 「サブスクリプション管理」から Stripe Customer Portal でプラン変更・解約

## 料金プラン

| プラン | 月額 | 機能 |
|--------|------|------|
| Free | ¥0 | 基本機能のみ |
| Pro | ¥980/月 | 全機能 + 優先サポート |
| Enterprise | ¥4,980/月 | 全機能 + チーム管理 + 専用サポート |
```

- [ ] **Step 2: Add entry to root README.md table**

Add the following row to the sample table in the root `README.md`, after the `nextjs-go-google_ucp` entry:

```markdown
| [nextjs-fastapi-clerk-stripe](nextjs-fastapi-clerk-stripe/) | Next.js + FastAPI + Clerk + Stripe + PostgreSQL | SaaS デモ（Clerk 認証 + Stripe サブスクリプション決済） | g2l-t-2 (2GB) |
```

- [ ] **Step 3: Commit**

```bash
git add nextjs-fastapi-clerk-stripe/README.md README.md
git commit -m "docs(nextjs-fastapi-clerk-stripe): add README and register in root sample list"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Project scaffolding | compose.yml, Dockerfiles, .env.example |
| 2 | Backend DB models & config | config.py, database.py, models.py |
| 3 | Clerk JWT auth | auth.py |
| 4 | Stripe service | stripe_service.py |
| 5 | Webhook handlers | webhooks.py |
| 6 | API endpoints | checkout.py, subscription.py |
| 7 | FastAPI entrypoint | main.py |
| 8 | Frontend config | package.json, next.config.ts, tsconfig.json |
| 9 | Layout & middleware | layout.tsx, globals.css, middleware.ts |
| 10 | API utility | api.ts |
| 11 | Landing page | page.tsx |
| 12 | Pricing page | pricing/page.tsx |
| 13 | Dashboard page | dashboard/page.tsx |
| 14 | Sign-in/Sign-up | sign-in, sign-up pages |
| 15 | README & registration | README.md (sample + root) |
