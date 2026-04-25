#!/bin/bash
# Setup script for hydra-python-api.
# - Registers an OAuth2 client via Hydra Admin API (Admin stays internal,
#   so we go through `docker compose exec`)
#
# Usage:
#   Local:  cd hydra-python-api && bash setup.sh
#   Remote: conoha server deploy <SERVER_ID> --script setup.sh --no-input
#
# APP_HOST must be the public FQDN of the Python app (root web host).
# When run remotely, `.env.server` is sourced so APP_HOST set via
# `conoha app env set` flows in. Locally, fall back to localhost.

set -e

# --- Locate compose directory ---
if [ -f compose.yml ]; then
  WORK_DIR="$(pwd)"
elif [ -f /opt/conoha/hydra-python-api/compose.yml ]; then
  WORK_DIR="/opt/conoha/hydra-python-api"
else
  echo "ERROR: Cannot find compose.yml. Run from project root or deploy to ConoHa first." >&2
  exit 1
fi
cd "$WORK_DIR"

# --- Source .env.server if present (set by conoha app env set) ---
if [ -f .env.server ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.server
  set +a
fi

# --- Resolve APP_HOST ---
if [ -n "$APP_HOST" ]; then
  REDIRECT_URI="https://${APP_HOST}/callback"
  echo "==> Using APP_HOST=$APP_HOST"
else
  REDIRECT_URI="http://localhost:9010/callback"
  echo "==> APP_HOST not set, using $REDIRECT_URI for local dev"
fi

# --- Wait for Hydra Admin to be ready (compose network only) ---
echo "==> Waiting for Hydra Admin to be ready..."
for i in $(seq 1 60); do
  if docker compose exec -T hydra wget -qO- http://localhost:4445/health/ready > /dev/null 2>&1; then
    echo "==> Hydra is ready."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "ERROR: Hydra did not become ready within 60 seconds." >&2
    docker compose logs hydra --tail 20
    exit 1
  fi
  sleep 1
done

# --- Register OAuth2 client (Admin API, internal only) ---
echo "==> Creating OAuth2 client 'demo-app'..."
docker compose exec -T hydra hydra create oauth2-client \
  --endpoint http://localhost:4445 \
  --name "Demo App" \
  --grant-type authorization_code,refresh_token \
  --response-type code \
  --scope openid,profile,email,offline_access \
  --redirect-uri "${REDIRECT_URI}" \
  --token-endpoint-auth-method client_secret_post

echo ""
echo "==> Setup complete!"
echo ""
if [ -n "$AUTH_HOST" ]; then
  echo "Authorization URL (replace <CLIENT_ID> with the client_id printed above):"
  echo "  https://${AUTH_HOST}/oauth2/auth?response_type=code&client_id=<CLIENT_ID>&redirect_uri=${REDIRECT_URI}&scope=openid+profile+email&state=random-state-12345"
else
  echo "AUTH_HOST not set; for VPS deploys, set AUTH_HOST via 'conoha app env set' to print the authorization URL."
fi
