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
# 1. Create a server (if you don't have one)
conoha server create --name ucp-demo --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. Edit conoha.yml and replace the `hosts:` placeholder with your FQDN
#    The DNS A record for that FQDN must already point at the server IP

# 3. Boot the proxy (once per server)
conoha proxy boot --acme-email you@example.com ucp-demo

# 4. Register the app
conoha app init ucp-demo

# 5. Deploy
conoha app deploy ucp-demo
```

`api` and `db` are declared as accessories, so they stay alive across blue/green swaps — only `frontend` is duplicated per slot. Access the site at `https://<your FQDN>` (the first request may take ~30s while Let's Encrypt issues a certificate).
