#!/usr/bin/env bash
# 00-provision.sh — create a ConoHa VPS and wait until SSH is reachable.
# Runs LOCALLY (needs the conoha CLI). Reads vcluster/.env if present.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # vcluster/
[ -f "${HERE}/.env" ] && { set -a; . "${HERE}/.env"; set +a; }

SERVER_NAME="${SERVER_NAME:-vcluster-host}"
FLAVOR="${FLAVOR:-g2l-t-4}"
IMAGE="${IMAGE:-ubuntu-24.04}"
KEY_NAME="${KEY_NAME:?set KEY_NAME (conoha keypair list) in .env or the environment}"

if ! conoha server list 2>/dev/null | grep -q "${SERVER_NAME}"; then
  echo "==> Creating server ${SERVER_NAME} (${FLAVOR}, ${IMAGE})"
  conoha server create --name "${SERVER_NAME}" --flavor "${FLAVOR}" --image "${IMAGE}" --key "${KEY_NAME}"
else
  echo "==> Server ${SERVER_NAME} already exists, skipping create"
fi

echo "==> Waiting for ACTIVE"
for i in $(seq 1 40); do
  status="$(conoha server show "${SERVER_NAME}" --format json 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)"
  echo "  status=${status:-<unknown>}"
  [ "${status}" = "ACTIVE" ] && break
  sleep 15
done

echo "==> Waiting for SSH"
until conoha server ssh "${SERVER_NAME}" -- echo ok 2>/dev/null; do sleep 5; done

SERVER_IP="$(conoha server show "${SERVER_NAME}" --format json \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["addresses"][0]["addr"])')"
echo "SERVER_IP=${SERVER_IP}"
echo "==> Provision complete: ${SERVER_NAME} (${SERVER_IP})"
