#!/usr/bin/env bash
# Issue a Cloudflare Origin CA certificate for a given hostname.
# Requires: CF_API_TOKEN with "Certificates: Edit" permission, openssl, jq, curl.
# Usage: ./scripts/issue-cf-origin-cert.sh <hostname> [output-dir]
set -euo pipefail

HOSTNAME="${1:?usage: $0 <hostname> [output-dir]}"
OUT="${2:-./certs}"
mkdir -p "$OUT" && chmod 700 "$OUT"

: "${CF_API_TOKEN:?CF_API_TOKEN env var required (token needs Certificates: Edit)}"

# 1. Generate RSA key + CSR
openssl genrsa -out "$OUT/${HOSTNAME}.key" 2048 2>/dev/null
openssl req -new -key "$OUT/${HOSTNAME}.key" -out "$OUT/${HOSTNAME}.csr" \
  -subj "/CN=${HOSTNAME}" 2>/dev/null

# 2. Request Origin CA cert
CSR=$(jq -Rs . < "$OUT/${HOSTNAME}.csr")
RESPONSE=$(curl -sS -X POST \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/certificates" \
  --data "{\"hostnames\":[\"$HOSTNAME\"],\"requested_validity\":5475,\"request_type\":\"origin-rsa\",\"csr\":$CSR}")

if ! echo "$RESPONSE" | jq -e '.success' >/dev/null; then
  echo "ERROR: certificate request failed:" >&2
  echo "$RESPONSE" | jq '.errors' >&2
  exit 1
fi

echo "$RESPONSE" | jq -r '.result.certificate' > "$OUT/${HOSTNAME}.crt"
chmod 644 "$OUT/${HOSTNAME}.crt"
chmod 600 "$OUT/${HOSTNAME}.key"
rm "$OUT/${HOSTNAME}.csr"

echo "Issued: $OUT/${HOSTNAME}.crt"
echo "Expires: $(echo "$RESPONSE" | jq -r '.result.expires_on')"
echo ""
echo "Next steps:"
echo "  1. scp these files to your VPS:"
echo "     ssh \$VPS 'mkdir -p /etc/caddy/certs && chmod 700 /etc/caddy/certs'"
echo "     scp $OUT/${HOSTNAME}.crt $OUT/${HOSTNAME}.key \$VPS:/etc/caddy/certs/"
echo "  2. Update caddy/Caddyfile to reference these paths"
echo "  3. Run: conoha app deploy <server> --app-name dashboard --no-proxy"
