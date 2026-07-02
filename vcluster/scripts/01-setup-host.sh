#!/usr/bin/env bash
# 01-setup-host.sh — install k3s (host cluster) + kubectl + vcluster CLI.
# Runs ON the VPS. Idempotent.
set -euo pipefail

K3S_VERSION="${K3S_VERSION:-v1.31.5+k3s1}"
VCLUSTER_VERSION="${VCLUSTER_VERSION:-v0.24.1}"

echo "==> Installing k3s ${K3S_VERSION} (host cluster)"
if ! command -v k3s >/dev/null 2>&1; then
  curl -sfL https://get.k3s.io \
    | INSTALL_K3S_VERSION="${K3S_VERSION}" sh -s - --write-kubeconfig-mode 644
fi

echo "==> Exposing kubectl via k3s symlink"
sudo ln -sf "$(command -v k3s)" /usr/local/bin/kubectl

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

echo "==> Waiting for the host cluster node to be Ready"
node_ready=0
for _ in $(seq 1 60); do
  if kubectl get nodes 2>/dev/null | grep -q ' Ready '; then
    node_ready=1
    break
  fi
  sleep 5
done
if [ "$node_ready" != 1 ]; then
  echo "host cluster node not Ready after timeout" >&2
  kubectl get nodes || true
  exit 1
fi
kubectl get nodes

echo "==> Installing vcluster CLI ${VCLUSTER_VERSION}"
installed_ver="$(vcluster --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
if ! command -v vcluster >/dev/null 2>&1 || [ "${installed_ver}" != "${VCLUSTER_VERSION#v}" ]; then
  arch="$(uname -m)"
  case "$arch" in
    x86_64) vc_arch=amd64 ;;
    aarch64|arm64) vc_arch=arm64 ;;
    *) echo "unsupported arch: $arch" >&2; exit 1 ;;
  esac
  curl -fsSL -o /tmp/vcluster \
    "https://github.com/loft-sh/vcluster/releases/download/${VCLUSTER_VERSION}/vcluster-linux-${vc_arch}"
  sudo install -m 0755 /tmp/vcluster /usr/local/bin/vcluster
  rm -f /tmp/vcluster
fi

echo "==> Versions"
kubectl version --client=true 2>/dev/null | head -1 || true
vcluster --version

echo "==> Host setup complete"
