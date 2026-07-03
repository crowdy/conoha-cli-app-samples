#!/usr/bin/env bash
# teardown.sh — tear down the sample.
#   default:          delete vclusters + uninstall k3s on the VPS (keeps the server)
#   --delete-server:  ALSO destroy the ConoHa VPS (and its boot volume)
# Runs LOCALLY.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # vcluster/
[ -f "${HERE}/.env" ] && { set -a; . "${HERE}/.env"; set +a; }

SERVER_NAME="${SERVER_NAME:-vcluster-host}"
TENANT_A_NS="${TENANT_A_NS:-team-a}"
TENANT_B_NS="${TENANT_B_NS:-team-b}"
DELETE_SERVER=0
[ "${1:-}" = "--delete-server" ] && DELETE_SERVER=1

echo "==> Deleting virtual clusters + uninstalling k3s on ${SERVER_NAME}"
conoha server ssh --insecure "${SERVER_NAME}" -- bash -lc "
set -uo pipefail
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
if command -v vcluster >/dev/null 2>&1; then
  vcluster delete tenant-a --namespace ${TENANT_A_NS} || true
  vcluster delete tenant-b --namespace ${TENANT_B_NS} || true
fi
if [ -x /usr/local/bin/k3s-uninstall.sh ]; then
  sudo /usr/local/bin/k3s-uninstall.sh || true
fi
sudo rm -f /usr/local/bin/vcluster /usr/local/bin/kubectl
" || echo "(server unreachable or already clean)"

if [ "${DELETE_SERVER}" -eq 1 ]; then
  echo "==> Destroying VPS ${SERVER_NAME} (and boot volume)"
  conoha server delete "${SERVER_NAME}" --delete-boot-volume --yes
  echo "==> Verifying"
  conoha server list | grep -q "${SERVER_NAME}" && echo "WARNING: server still listed" || echo "destroyed cleanly"
else
  echo "==> Kept the VPS. Re-run with --delete-server to destroy it."
fi
