#!/bin/bash
# Setup script for hydra-python-api.
# - Detects server IP (remote) or uses localhost (local)
# - Updates .env and restarts containers
# - Registers an OAuth2 client
#
# Usage:
#   Local:  cd hydra-python-api && bash setup.sh
#   Remote: conoha server deploy <SERVER_ID> --script setup.sh --no-input

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

# --- Detect SERVER_HOST ---
if [ -n "$SERVER_HOST" ] && [ "$SERVER_HOST" != "localhost" ]; then
  HOST="$SERVER_HOST"
  echo "==> Using provided SERVER_HOST=$HOST"
elif IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null) && [ -n "$IP" ]; then
  HOST="$IP"
  echo "==> Detected public IP: $HOST"
elif IP=$(hostname -I 2>/dev/null | awk '{print $1}') && [ -n "$IP" ]; then
  HOST="$IP"
  echo "==> Detected host IP: $HOST"
else
  HOST="localhost"
  echo "==> Could not detect IP, using localhost"
fi

# --- Update .env ---
echo "SERVER_HOST=$HOST" > .env
echo "==> Updated .env: SERVER_HOST=$HOST"

# --- Restart containers with new env ---
echo "==> Restarting containers..."
docker compose up -d

# --- Wait for Hydra to be ready ---
echo "==> Waiting for Hydra to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:4444/health/ready > /dev/null 2>&1; then
    echo "==> Hydra is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Hydra did not become ready within 30 seconds." >&2
    docker compose logs hydra --tail 20
    exit 1
  fi
  sleep 1
done

# --- Register OAuth2 client ---
echo "==> Creating OAuth2 client 'demo-app'..."
docker compose exec hydra hydra create oauth2-client \
  --endpoint http://localhost:4445 \
  --name "Demo App" \
  --grant-type authorization_code,refresh_token \
  --response-type code \
  --scope openid,profile,email,offline_access \
  --redirect-uri "http://${HOST}:9010/callback" \
  --token-endpoint-auth-method client_secret_post

echo ""
echo "==> Setup complete!"
echo ""
echo "Authorization URL:"
echo "  http://${HOST}:4444/oauth2/auth?response_type=code&client_id=<CLIENT_ID>&redirect_uri=http://${HOST}:9010/callback&scope=openid+profile+email&state=random-state-12345"
