#!/usr/bin/env bash
# smoke-test.sh — end-to-end: provision -> setup -> create vclusters -> verify.
# Runs LOCALLY. Orchestrates the on-VPS steps over `conoha server ssh`.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # vcluster/
[ -f "${HERE}/.env" ] && { set -a; . "${HERE}/.env"; set +a; }

SERVER_NAME="${SERVER_NAME:-vcluster-host}"
K3S_VERSION="${K3S_VERSION:-v1.31.5+k3s1}"
VCLUSTER_VERSION="${VCLUSTER_VERSION:-v0.24.1}"
TENANT_A_NS="${TENANT_A_NS:-team-a}"
TENANT_B_NS="${TENANT_B_NS:-team-b}"
REPO_URL="${REPO_URL:-https://github.com/crowdy/conoha-cli-app-samples}"
REPO_BRANCH="${REPO_BRANCH:-main}"

# 1. Provision (idempotent).
bash "${HERE}/scripts/00-provision.sh"

# Environment string forwarded into each remote invocation.
REMOTE_ENV="K3S_VERSION=${K3S_VERSION} VCLUSTER_VERSION=${VCLUSTER_VERSION} TENANT_A_NS=${TENANT_A_NS} TENANT_B_NS=${TENANT_B_NS}"

echo "==> [1/3] Clone sample + host setup on the VPS"
conoha server ssh "${SERVER_NAME}" -- bash -lc "
set -euo pipefail
sudo apt-get update -qq && sudo apt-get install -y -qq git
rm -rf ~/conoha-cli-app-samples
git clone --depth 1 --branch ${REPO_BRANCH} ${REPO_URL} ~/conoha-cli-app-samples
cd ~/conoha-cli-app-samples/vcluster
${REMOTE_ENV} bash scripts/01-setup-host.sh
"

echo "==> [2/3] Create virtual clusters on the VPS"
conoha server ssh "${SERVER_NAME}" -- bash -lc "
set -euo pipefail
cd ~/conoha-cli-app-samples/vcluster
${REMOTE_ENV} bash scripts/02-create-vclusters.sh
"

echo "==> [3/3] Verify isolation on the VPS"
conoha server ssh "${SERVER_NAME}" -- bash -lc "
set -euo pipefail
cd ~/conoha-cli-app-samples/vcluster
${REMOTE_ENV} bash scripts/03-verify.sh
"

echo
echo "SMOKE TEST PASSED"
