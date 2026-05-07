#!/usr/bin/env bash
# End-to-end curl walkthrough for the dns-server admin API.
#
# Usage:
#   export TOKEN="<value printed in pdns-init log>"
#   export API="https://api.example.com"   # or http://127.0.0.1:8080 in dev
#   ./examples/curl.sh
set -euo pipefail

: "${TOKEN:?set TOKEN to the admin token from the pdns-init log}"
API="${API:-https://api.example.com}"

echo "==> Zone meta (no auth required)"
curl -fsS "$API/v1/zone" | tee /dev/stderr; echo

echo "==> Create tkim.users.example.com (A + TXT)"
curl -fsS -X POST "$API/v1/subdomains" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tkim.users.example.com",
    "records": [
      {"type": "A", "value": "203.0.113.42"},
      {"type": "TXT", "value": "v=spf1 -all"}
    ]
  }' | tee /dev/stderr; echo

echo "==> Create blog.tkim.users.example.com (CNAME)"
curl -fsS -X POST "$API/v1/subdomains" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "blog.tkim.users.example.com",
    "records": [{"type": "CNAME", "value": "tkim.users.example.com."}]
  }' | tee /dev/stderr; echo

echo "==> List"
curl -fsS "$API/v1/subdomains" -H "Authorization: Bearer $TOKEN" | tee /dev/stderr; echo

echo "==> Replace tkim with new IP (PUT)"
curl -fsS -X PUT "$API/v1/subdomains/tkim.users.example.com" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"records":[{"type":"A","value":"203.0.113.99"}]}' | tee /dev/stderr; echo

echo "==> Delete tkim (blog. is reported as orphan)"
curl -fsS -X DELETE "$API/v1/subdomains/tkim.users.example.com" \
  -H "Authorization: Bearer $TOKEN" | tee /dev/stderr; echo

echo "==> Done"
