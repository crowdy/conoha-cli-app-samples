#!/bin/sh
# One-shot: wait for k3s, apply pinned KubeVirt, wait Available, ensure namespace.
# Idempotent — safe to re-run.
set -eu

KUBECONFIG_SRC="${KUBECONFIG_SRC:-/output/kubeconfig.yaml}"
NS="${VM_NAMESPACE:-vms}"
export KUBECONFIG=/tmp/kubeconfig.yaml

echo "[bootstrap] waiting for kubeconfig at $KUBECONFIG_SRC ..."
while [ ! -f "$KUBECONFIG_SRC" ]; do sleep 2; done

# k3s writes server https://127.0.0.1:6443; from this container we must reach k3s
# by its compose service name. The server cert covers it via k3s --tls-san=k3s.
cp "$KUBECONFIG_SRC" "$KUBECONFIG"
kubectl --kubeconfig="$KUBECONFIG" config set-cluster default --server=https://k3s:6443 >/dev/null

echo "[bootstrap] waiting for cluster /readyz ..."
until kubectl get --raw=/readyz >/dev/null 2>&1; do sleep 3; done

echo "[bootstrap] applying KubeVirt operator + CR ..."
kubectl apply -f /manifests/kubevirt-operator.yaml
kubectl apply -f /manifests/kubevirt-cr.yaml

echo "[bootstrap] waiting for KubeVirt Available (up to 10m) ..."
kubectl -n kubevirt wait kubevirt/kubevirt --for=condition=Available --timeout=600s

echo "[bootstrap] ensuring namespace $NS ..."
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

echo "[bootstrap] done."
