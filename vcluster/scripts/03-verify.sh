#!/usr/bin/env bash
# 03-verify.sh — prove the three isolation properties. Exits non-zero on any failure.
# Runs ON the VPS after 02-create-vclusters.sh.
set -euo pipefail

export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
TENANT_A_NS="${TENANT_A_NS:-team-a}"
TENANT_B_NS="${TENANT_B_NS:-team-b}"
CRD="crontabs.stable.example.com"
HOST_ONLY_NS="host-only-ns"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok()   { echo "  ok: $*"; }

# Helper: run kubectl inside a tenant vcluster.
vk() {  # vk <name> <ns> <kubectl args...>
  local name="$1" ns="$2"; shift 2
  vcluster connect "${name}" --namespace "${ns}" -- kubectl "$@"
}

echo "=== [1/3] CRD isolation ==="
vk tenant-a "${TENANT_A_NS}" get crd "${CRD}" >/dev/null 2>&1 \
  || fail "CRD ${CRD} should exist in tenant-a but does not"
ok "CRD present in tenant-a"
# Probe tenant-b reachability first, so a connect failure can't be misread as "CRD absent".
vk tenant-b "${TENANT_B_NS}" get ns default >/dev/null 2>&1 \
  || fail "cannot reach tenant-b vcluster to verify CRD isolation"
if vk tenant-b "${TENANT_B_NS}" get crd "${CRD}" >/dev/null 2>&1; then
  fail "CRD ${CRD} leaked into tenant-b"
fi
ok "CRD absent in tenant-b"
if kubectl get crd "${CRD}" >/dev/null 2>&1; then
  fail "CRD ${CRD} leaked into the HOST cluster"
fi
ok "CRD absent on host"

echo "=== [2/3] cluster-admin isolation (tenant cannot see host resources) ==="
# Create a namespace directly on the HOST.
kubectl create namespace "${HOST_ONLY_NS}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
# Probe tenant-a reachability first, so a connect failure can't be misread as "not visible".
vk tenant-a "${TENANT_A_NS}" get ns default >/dev/null 2>&1 \
  || fail "cannot reach tenant-a vcluster to verify host-namespace isolation"
# A cluster-admin INSIDE tenant-a must not be able to see the host-only namespace.
if vk tenant-a "${TENANT_A_NS}" get namespace "${HOST_ONLY_NS}" >/dev/null 2>&1; then
  fail "tenant-a can see host namespace ${HOST_ONLY_NS} — isolation broken"
fi
ok "tenant-a cannot see host namespace ${HOST_ONLY_NS}"
# And tenant-a must not see the host's real node-level daemonsets etc. Check kube-system differs:
# the host has traefik/local-path-provisioner from k3s; tenant-a's kube-system does not.
pods_a="$(vk tenant-a "${TENANT_A_NS}" get pods -n kube-system 2>/dev/null)" \
  || fail "could not list pods in tenant-a kube-system (vcluster connect failed?)"
if echo "${pods_a}" | grep -q 'local-path-provisioner'; then
  fail "tenant-a can see host k3s system pod (local-path-provisioner) — isolation broken"
fi
ok "tenant-a's kube-system is virtual (no host k3s system pods)"

echo "=== [3/3] host node sharing (both tenants' pods land on the same host node) ==="
# The syncer projects tenant pods into the host namespace (team-a/team-b).
node_a="$(kubectl get pods -n "${TENANT_A_NS}" -l vcluster.loft.sh/label-app=demo \
  -o jsonpath='{.items[0].spec.nodeName}' 2>/dev/null || true)"
if [ -z "${node_a}" ]; then
  # Fallback: match the synced demo pod by name prefix.
  node_a="$(kubectl get pods -n "${TENANT_A_NS}" -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.nodeName}{"\n"}{end}' \
    | grep '^demo' | awk '{print $2}' | head -1 || true)"
fi
node_b="$(kubectl get pods -n "${TENANT_B_NS}" -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.nodeName}{"\n"}{end}' \
  | grep '^demo' | awk '{print $2}' | head -1)"
echo "  tenant-a demo pod scheduled on host node: ${node_a:-<none>}"
echo "  tenant-b demo pod scheduled on host node: ${node_b:-<none>}"
[ -n "${node_a}" ] || fail "could not find tenant-a's synced demo pod on the host"
[ -n "${node_b}" ] || fail "could not find tenant-b's synced demo pod on the host"
[ "${node_a}" = "${node_b}" ] || fail "tenant pods landed on different nodes (${node_a} != ${node_b})"
ok "both tenants' pods run on the same host node (${node_a})"

echo
echo "ALL ISOLATION CHECKS PASSED"
