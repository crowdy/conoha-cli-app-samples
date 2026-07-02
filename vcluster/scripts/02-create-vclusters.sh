#!/usr/bin/env bash
# 02-create-vclusters.sh — create two virtual clusters (tenant-a, tenant-b),
# deploy a demo workload into each, and install a CRD only into tenant-a.
# Runs ON the VPS after 01-setup-host.sh. Run from the vcluster/ dir.
set -euo pipefail

export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
TENANT_A_NS="${TENANT_A_NS:-team-a}"
TENANT_B_NS="${TENANT_B_NS:-team-b}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # vcluster/

create_vcluster() {
  local name="$1" ns="$2"
  echo "==> Creating virtual cluster '${name}' in namespace '${ns}'"
  # --connect=false: do not start an interactive port-forward; we connect per-command later.
  if ! vcluster list 2>/dev/null | awk '{print $1}' | grep -qx "${name}"; then
    vcluster create "${name}" --namespace "${ns}" --connect=false
  fi
  echo "==> Waiting for '${name}' control plane to be ready"
  local ready=0
  for _ in $(seq 1 60); do
    if kubectl get pods -n "${ns}" 2>/dev/null | grep -E "^${name}-0" | grep -q 'Running'; then ready=1; break; fi
    sleep 5
  done
  if [ "${ready}" != 1 ]; then
    echo "ERROR: '${name}' control plane did not reach Running after timeout" >&2
    kubectl get pods -n "${ns}" || true
    exit 1
  fi
}

deploy_demo() {
  local name="$1" ns="$2"
  echo "==> Deploying demo Pod into '${name}'"
  vcluster connect "${name}" --namespace "${ns}" -- kubectl apply -f "${HERE}/manifests/demo-pod.yaml"
}

create_vcluster tenant-a "${TENANT_A_NS}"
create_vcluster tenant-b "${TENANT_B_NS}"

echo "==> Installing CRD + CR ONLY into tenant-a"
vcluster connect tenant-a --namespace "${TENANT_A_NS}" -- kubectl apply -f "${HERE}/manifests/tenant-a-crd.yaml"
# Wait for the CRD to be established inside tenant-a before applying the CR.
vcluster connect tenant-a --namespace "${TENANT_A_NS}" -- \
  kubectl wait --for=condition=Established crd/crontabs.stable.example.com --timeout=60s
vcluster connect tenant-a --namespace "${TENANT_A_NS}" -- kubectl apply -f "${HERE}/manifests/tenant-a-cr.yaml"

deploy_demo tenant-a "${TENANT_A_NS}"
deploy_demo tenant-b "${TENANT_B_NS}"

echo "==> Virtual clusters ready:"
vcluster list
