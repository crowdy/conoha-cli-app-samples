#!/usr/bin/env bash
# 00-provision.sh — create a ConoHa VPS and wait until SSH is reachable.
# Runs LOCALLY (needs the conoha CLI). Reads vcluster/.env if present.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # vcluster/
[ -f "${HERE}/.env" ] && { set -a; . "${HERE}/.env"; set +a; }

SERVER_NAME="${SERVER_NAME:-vcluster-host}"
FLAVOR="${FLAVOR:-g2l-t-c4m4}"      # 4 vCPU / 4GB. Confirm names with: conoha flavor list
IMAGE="${IMAGE:-ubuntu-24.04}"      # image ID or name; confirm with: conoha image list
KEY_NAME="${KEY_NAME:?set KEY_NAME (conoha keypair list) in .env or the environment}"
# Space-separated security group names. SSH access is required for `conoha server ssh`.
# Confirm names with: conoha network security-group list
SECURITY_GROUPS="${SECURITY_GROUPS:-default IPv4v6-SSH}"

if ! conoha server list 2>/dev/null | grep -q "${SERVER_NAME}"; then
  echo "==> Creating server ${SERVER_NAME} (${FLAVOR}, ${IMAGE})"
  sg_args=()
  for sg in ${SECURITY_GROUPS}; do sg_args+=(--security-group "${sg}"); done
  conoha server create --name "${SERVER_NAME}" --flavor "${FLAVOR}" --image "${IMAGE}" \
    --key-name "${KEY_NAME}" "${sg_args[@]}" --no-input --yes
else
  echo "==> Server ${SERVER_NAME} already exists, skipping create"
fi

echo "==> Waiting for ACTIVE"
active=0
for i in $(seq 1 40); do
  status="$(conoha server show "${SERVER_NAME}" --format json 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || true)"
  echo "  status=${status:-<unknown>}"
  if [ "${status}" = "ACTIVE" ]; then active=1; break; fi
  sleep 15
done
if [ "${active}" != 1 ]; then
  echo "ERROR: server ${SERVER_NAME} did not reach ACTIVE after $((40*15))s" >&2
  exit 1
fi

SERVER_IP="$(conoha server show "${SERVER_NAME}" --format json \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); ips=[a["addr"] for net in d["addresses"].values() for a in net if a.get("version")==4]; print(ips[0] if ips else "")')"
[ -n "${SERVER_IP}" ] || { echo "ERROR: could not determine IPv4 address for ${SERVER_NAME}" >&2; exit 1; }

echo "==> Waiting for SSH on ${SERVER_IP} (registering host key)"
# conoha's --insecure does not reliably disable host-key checks (CLI v0.7.1), so we
# pre-seed known_hosts. Drop any stale entry first (public IPs get reused across VPS).
ssh-keygen -R "${SERVER_IP}" >/dev/null 2>&1 || true
until ssh-keyscan "${SERVER_IP}" 2>/dev/null | grep -q .; do sleep 5; done
ssh-keyscan -H "${SERVER_IP}" >> ~/.ssh/known_hosts 2>/dev/null
until conoha server ssh "${SERVER_NAME}" -- echo ok 2>/dev/null; do sleep 5; done

echo "SERVER_IP=${SERVER_IP}"
echo "==> Provision complete: ${SERVER_NAME} (${SERVER_IP})"
