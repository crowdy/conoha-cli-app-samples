#!/bin/bash
# Register an OAuth2 client after Hydra is running.
# Run this once after `conoha app deploy` or `docker compose up`.

set -e

HYDRA_ADMIN=${HYDRA_ADMIN:-http://localhost:4445}

echo "==> Creating OAuth2 client 'demo-app'..."
docker compose exec hydra hydra create oauth2-client \
  --endpoint http://localhost:4445 \
  --name "Demo App" \
  --grant-type authorization_code,refresh_token \
  --response-type code \
  --scope openid,profile,email,offline_access \
  --redirect-uri http://localhost:9010/callback \
  --token-endpoint-auth-method client_secret_post

echo ""
echo "==> Done! Use the client_id and client_secret above to start an OAuth2 flow."
echo ""
echo "Authorization URL:"
echo "  http://localhost:4444/oauth2/auth?response_type=code&client_id=<CLIENT_ID>&redirect_uri=http://localhost:9010/callback&scope=openid+profile+email&state=random-state"
