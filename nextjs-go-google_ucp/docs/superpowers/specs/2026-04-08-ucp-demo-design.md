# UCP Demo Flower Shop — Design Spec

## Context

Google's Universal Commerce Protocol (UCP) defines a standard for AI agents to discover merchant capabilities and execute commerce flows (search → checkout → payment) via `/.well-known/ucp` manifests. This sample demonstrates the protocol in a Next.js + Go + PostgreSQL stack, deployable via `conoha-cli app deploy`.

**Purpose:** Educational/demo — developers can run locally, browse a mock flower shop, and use the UCP Inspector to see exactly what HTTP requests an AI agent would send.

## Architecture

```
frontend (Next.js 15, :80)     api (Go 1.23, :8080)      db (PostgreSQL 17, :5432)
├── /                          ├── GET /ucp/manifest      ├── products
├── /checkout                  ├── GET /products           ├── checkout_sessions
├── /inspector                 ├── GET /products/:id       └── checkout_items
└── /.well-known/ucp           ├── POST /checkout-sessions
    (route.ts → Go proxy)      ├── GET /checkout-sessions/:id
                               ├── PUT /checkout-sessions/:id
                               ├── POST /checkout-sessions/:id/complete
                               └── GET /health
```

- `frontend` only port exposed (80). `api` and `db` internal only.
- `/.well-known/ucp` served by Next.js route handler, proxying to Go's `/ucp/manifest`.
- Follows existing `nextjs-fastapi-postgresql` sample pattern (compose 3-service, healthcheck, volume).

## DB Schema

```sql
CREATE TABLE products (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'USD',
    image_url   TEXT,
    in_stock    BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE checkout_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status          TEXT NOT NULL DEFAULT 'incomplete',
    currency        TEXT NOT NULL DEFAULT 'USD',
    subtotal_cents  INTEGER NOT NULL DEFAULT 0,
    discount_cents  INTEGER NOT NULL DEFAULT 0,
    total_cents     INTEGER NOT NULL DEFAULT 0,
    buyer_email     TEXT,
    payment_handler TEXT,
    payment_token   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE checkout_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES checkout_sessions(id),
    product_id  UUID NOT NULL REFERENCES products(id),
    quantity    INTEGER NOT NULL DEFAULT 1,
    price_cents INTEGER NOT NULL
);
```

**Session status flow:** `incomplete → payment_pending → complete | cancelled`

**Seed data:** 5 flower products (Sunflower Bouquet $24.99, Red Rose Arrangement $39.99, Lavender Bundle $18.99, Mixed Wildflowers $29.99, Single White Lily $12.99).

## Go API

### UCP Manifest

`GET /ucp/manifest` returns:

```json
{
  "ucp": {
    "version": "2026-01-23",
    "services": {
      "dev.ucp.shopping": {
        "version": "2026-01-23",
        "spec": "https://ucp.dev/specs/shopping",
        "rest": {
          "schema": "https://ucp.dev/services/shopping/openapi.json",
          "endpoint": "http://localhost/api/"
        }
      }
    },
    "capabilities": [
      {
        "name": "dev.ucp.shopping.checkout",
        "version": "2026-01-23",
        "spec": "https://ucp.dev/specs/shopping/checkout"
      },
      {
        "name": "dev.ucp.shopping.discount",
        "version": "2026-01-23",
        "extends": "dev.ucp.shopping.checkout"
      }
    ]
  },
  "payment": {
    "handlers": [{
      "id": "mock_google_pay",
      "name": "google.pay",
      "config": {
        "merchant_name": "UCP Demo Flower Shop",
        "environment": "TEST"
      }
    }]
  }
}
```

### Capability Negotiation

Simplified for demo: `POST /checkout-sessions` accepts `requested_capabilities` in body. Server computes intersection with supported capabilities, prunes extensions whose parent is absent, returns active set in response.

### Mock Payment

`POST /checkout-sessions/:id/complete` with `{ "payment": { "handler_id": "mock_google_pay", "token": "<any>" } }`. Token "fail" returns error; anything else succeeds.

### DB Access

sqlc — SQL queries in `api/db/queries/*.sql`, generated Go code in `api/generated/`.

### HTTP Router

Standard library `net/http` with Go 1.22+ routing patterns (`GET /products/{id}`). No external router dependency.

## Next.js Frontend

### Pages

| Route | Description |
|-------|-------------|
| `/` | Product grid with "Add to Cart" buttons. shadcn Card components. |
| `/checkout` | Cart summary, discount code Input, mock pay Button. |
| `/inspector` | UCP Inspector with two Tabs. |
| `/.well-known/ucp/route.ts` | Route handler proxying to `${API_URL}/ucp/manifest`. |

### UCP Inspector

**Tab 1 — Manifest Viewer:**
- Fetches `/.well-known/ucp`, renders JSON as collapsible tree
- Color-coded Badge for capabilities, payment handlers, services
- Tooltip on each field explaining UCP spec meaning

**Tab 2 — Checkout Simulator:**
- 5-step interactive flow:
  1. **Discovery** — [Fetch Manifest] button → shows GET request/response
  2. **Negotiation** — Checkbox select agent capabilities → shows intersection result
  3. **Create Session** — Pick products + buyer email → shows POST request/response
  4. **Apply Discount** (optional) — Enter code → shows PUT request/response
  5. **Complete Payment** — Enter mock token → shows POST complete request/response
- Each step displays raw HTTP request and response JSON in code blocks

### State Management

React useState only. Cart state in client memory. No external state library.

### UI

shadcn/ui + Tailwind CSS. Components used: Card, Button, Input, Badge, Tabs, Accordion, Dialog, Sheet (cart drawer).

## Directory Structure

```
nextjs-go-google_ucp/
├── compose.yml
├── README.md
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── next.config.ts
│   ├── components.json
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── checkout/page.tsx
│   │   ├── inspector/page.tsx
│   │   └── .well-known/ucp/route.ts
│   ├── components/
│   │   ├── ui/                    # shadcn/ui
│   │   ├── product-card.tsx
│   │   ├── cart-sheet.tsx
│   │   ├── checkout-form.tsx
│   │   ├── manifest-viewer.tsx
│   │   └── checkout-simulator.tsx
│   └── lib/
│       ├── api.ts
│       └── utils.ts
├── api/
│   ├── Dockerfile
│   ├── go.mod
│   ├── main.go
│   ├── handler/
│   │   ├── manifest.go
│   │   ├── products.go
│   │   ├── checkout.go
│   │   └── health.go
│   ├── ucp/
│   │   ├── manifest.go
│   │   └── negotiation.go
│   ├── db/
│   │   ├── migrations/001_init.sql
│   │   ├── queries/products.sql
│   │   ├── queries/checkout.sql
│   │   └── sqlc.yaml
│   └── generated/
└── docs/
```

## compose.yml

```yaml
services:
  frontend:
    build: ./frontend
    ports:
      - "80:3000"
    environment:
      - API_URL=http://api:8080
    depends_on:
      api:
        condition: service_healthy

  api:
    build: ./api
    expose:
      - "8080"
    environment:
      - DATABASE_URL=postgres://appuser:apppass@db:5432/appdb?sslmode=disable
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080/health"]
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
      - ./api/db/migrations:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U appuser -d appdb"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  db_data:
```

## Verification

1. `docker compose up --build` — all 3 services start healthy
2. `curl http://localhost/.well-known/ucp` — returns valid UCP manifest JSON
3. Browse `http://localhost` — product grid renders with 5 flowers
4. Add items to cart, complete checkout — session persisted in PostgreSQL
5. Browse `http://localhost/inspector` — manifest viewer shows parsed JSON tree
6. Run checkout simulator step-by-step — each step shows correct request/response
7. `docker compose exec db psql -U appuser -d appdb -c "SELECT * FROM checkout_sessions"` — verify data persistence
