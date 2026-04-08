# Next.js + Go + Google UCP Demo

A demo flower shop implementing [Google's Universal Commerce Protocol (UCP)](https://developers.google.com/pay/api/universal-commerce-protocol/overview) — the open standard for AI agent-driven commerce.

## Architecture

```
Next.js 15 (frontend, :80)  →  Go 1.23 (API, :8080)  →  PostgreSQL 17 (:5432)
```

- **Frontend**: Product browsing, checkout UI, UCP Inspector with manifest viewer and checkout simulator
- **API**: UCP manifest (`/.well-known/ucp`), capability negotiation, checkout session CRUD, mock payment
- **DB**: Products catalog, checkout sessions

## Quick Start

```bash
docker compose up --build
```

Then open:
- http://localhost — Flower shop
- http://localhost/inspector — UCP Inspector
- http://localhost/.well-known/ucp — Raw UCP manifest

## UCP Inspector

### Manifest Viewer
Browse the `/.well-known/ucp` manifest with color-coded sections for services, capabilities, and payment handlers.

### Checkout Simulator
Walk through a complete UCP checkout as an AI agent would:

1. **Discovery** — Fetch the manifest
2. **Negotiation** — Select agent capabilities, compute intersection
3. **Create Session** — Pick a product, create checkout session
4. **Apply Discount** — Optionally apply a discount code
5. **Complete Payment** — Submit mock payment token

Each step shows the raw HTTP request and response.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/ucp` | UCP manifest (proxied from frontend) |
| GET | `/api/products` | List products |
| GET | `/api/products/:id` | Get product |
| POST | `/api/checkout-sessions` | Create checkout session |
| GET | `/api/checkout-sessions/:id` | Get session |
| PUT | `/api/checkout-sessions/:id` | Update session (apply discount) |
| POST | `/api/checkout-sessions/:id/complete` | Complete payment |

## Deploy with conoha-cli

```bash
conoha server create --name ucp-demo --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
conoha app init ucp-demo --app-name ucp-demo
conoha app deploy ucp-demo --app-name ucp-demo
```
