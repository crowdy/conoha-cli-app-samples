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
# Ensure the host key is known for a non-interactive SSH (see 00-provision.sh).
SERVER_IP="$(conoha server show "${SERVER_NAME}" --format json 2>/dev/null \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); ips=[a["addr"] for net in d["addresses"].values() for a in net if a.get("version")==4]; print(ips[0] if ips else "")' 2>/dev/null || true)"
if [ -n "${SERVER_IP}" ]; then
  ssh-keygen -R "${SERVER_IP}" >/dev/null 2>&1 || true
  ssh-keyscan -H "${SERVER_IP}" >> ~/.ssh/known_hosts 2>/dev/null || true
fi
conoha server ssh "${SERVER_NAME}" -- bash -lc "
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
  # Exact-match the NAME so a differently-named server is not mistaken for this one.
  if conoha server list --format json 2>/dev/null \
    | SN="${SERVER_NAME}" python3 -c 'import json,os,sys; sys.exit(0 if os.environ["SN"] in [s.get("name","") for s in json.load(sys.stdin)] else 1)'; then
    echo "WARNING: server still listed"
  else
    echo "destroyed cleanly"
  fi
else
  echo "==> Kept the VPS. Re-run with --delete-server to destroy it."
fi
