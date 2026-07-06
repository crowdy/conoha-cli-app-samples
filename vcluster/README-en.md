> [日本語](README.md) | English | [한국어](README-ko.md)

# vcluster — Running Virtual Kubernetes Clusters in Multi-Tenant Mode on a ConoHa VPS

[vCluster](https://github.com/loft-sh/vcluster) (loft-sh, Apache-2.0) is an OSS tool that stands up a **"virtual k8s cluster with its own API server" inside a single namespace** of a host Kubernetes cluster. Because the control plane is isolated per tenant while the nodes (data plane) are shared with the host:

- It is **safe to hand cluster-admin to tenants** (limited to inside their own virtual cluster)
- Each tenant can have their own **custom CRDs / API versions / cluster-scoped resources**
- **Lightweight and created in seconds** compared to spinning up multiple real clusters

This makes it a strong multi-tenancy solution.

This sample installs **k3s (lightweight single-node k8s)** on a ConoHa VPS (a bare Linux box), then creates **two isolated virtual clusters (`tenant-a` / `tenant-b`) with vCluster** on top of it, and demonstrates the isolation with actual commands. No GPU required.

> Like `dokploy`, this sample is a **non-compose sample that does not use `conoha app deploy`**. It has no `compose.yml` / `conoha.yml` and is completed entirely with `conoha server create` + `conoha server ssh` + scripts.

## Positioning vs. Similar Approaches

- **Kamaji (Clastix) / k0smotron (Mirantis)**: "Hosted Control Plane" type
- **Capsule (Clastix)**: "Namespace isolation" type
- **vCluster**: "Virtual control plane within a namespace" type — sits in between these three families, and its distinguishing feature is the ability to safely hand cluster-admin and custom CRDs to tenants.

## Recommended Flavor

- **`g2l-t-c4m4` (4 vCPU / 4GB) recommended** / minimum `g2l-t-c3m2` (3 vCPU / 2GB). 2–4 GB is sufficient for k3s + 2–3 vcluster instances. **No GPU required**.
- Flavor and image names vary by region and time — confirm available names with `conoha flavor list` and `conoha image list`.

## Prerequisites

- `conoha` CLI is set up ([conoha-cli](https://github.com/crowdy/conoha-cli)).
- An SSH key pair is registered in ConoHa (note the name visible in `conoha keypair list`).
- `git` / `bash` / `python3` available locally.
- A security group opening SSH (port 22) is required; `00-provision.sh` attaches `default IPv4v6-SSH` by default (override via the `SECURITY_GROUPS` env var).
- The fresh VPS host key is registered automatically by `00-provision.sh` via `ssh-keyscan` (so non-interactive `conoha server ssh` works).

## Quick Start (Automated e2e)

```bash
cd vcluster
cp .env.example .env
# .env の KEY_NAME を自分のキーペア名に、必要なら SERVER_NAME/FLAVOR を編集

# 作成 → k3s+vcluster 導入 → 仮想クラスタ2つ作成 → 隔離検証 まで一気に実行
bash scripts/smoke-test.sh
```

When `SMOKE TEST PASSED` appears at the end, two isolated virtual clusters are running on the VPS and all three isolation checks have been verified.

## Manual Steps (Understanding Each Step)

```bash
cd vcluster
cp .env.example .env   # KEY_NAME などを編集

# 1) VPS を作成し SSH 到達を待つ（ローカル実行）
bash scripts/00-provision.sh

# 2) VPS にログインし、リポジトリを clone
conoha server ssh "$(. ./.env; echo "$SERVER_NAME")"
#   --- 以降は VPS 上 ---
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/crowdy/conoha-cli-app-samples
cd conoha-cli-app-samples/vcluster

# 3) k3s + kubectl + vcluster CLI を導入
bash scripts/01-setup-host.sh

# 4) tenant-a / tenant-b を作成し、デモ Pod と CRD を投入
bash scripts/02-create-vclusters.sh

# 5) 隔離 3 種を検証
bash scripts/03-verify.sh
```

## Demonstrating Isolation (the Core of This Sample)

`scripts/03-verify.sh` verifies the following with actual commands, and succeeds only when all are satisfied.

1. **CRD isolation** — The CRD placed in `tenant-a` (`crontabs.stable.example.com`) is not visible from `tenant-b` or from the host.
2. **cluster-admin isolation** — Even with cluster-admin inside `tenant-a`, you cannot access or see namespaces created directly on the host (`host-only-ns`) or host k3s system Pods (`local-path-provisioner`).
3. **Shared host node** — The demo Pods from both tenants are scheduled onto the **same node** on the host via the syncer. This can be verified from the host side:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get pods -n team-a -o wide   # tenant-a の同期実 Pod
kubectl get pods -n team-b -o wide   # tenant-b の同期実 Pod（同じ NODE 列になる）
```

## Connecting to a Virtual Cluster

Since cloud VPSes have no LoadBalancer, the default uses vCluster's built-in port-forward.

```bash
# VPS 上で対話的に tenant-a の kubectl を使う
vcluster connect tenant-a --namespace team-a
# 別ターミナルで:
kubectl get pods -A     # tenant-a から見た「自分専用クラスタ」
# 終了:
vcluster disconnect
```

Storage works out of the box in each virtual cluster using k3s's `local-path-provisioner`, so PVCs work as-is.

## External Access (NodePort) — Important Note

If you want to connect directly from an external kubectl, you can expose via NodePort, but **exposing an API server directly to the outside is dangerous**. Be sure to restrict source IPs using ConoHa's security group / firewall.

```bash
# 例: tenant-a の API を NodePort で公開（アクセス元を絞ったうえで）
vcluster connect tenant-a --namespace team-a --expose   # LoadBalancer/NodePort 経由の kubeconfig を生成
```

> Do not leave the security group open. Once verification is complete, close it or destroy the VPS entirely with `teardown.sh --delete-server`.

## Teardown

```bash
# 仮想クラスタ削除 + k3s アンインストール（VPS は残す）
bash scripts/teardown.sh

# VPS ごと破棄（ブートボリュームも削除）
bash scripts/teardown.sh --delete-server
```

## Configuration Files

| File | Role |
|------|------|
| `scripts/00-provision.sh` | [Local] `conoha server create` + wait for SSH |
| `scripts/01-setup-host.sh` | [VPS] Install k3s + kubectl + vcluster CLI |
| `scripts/02-create-vclusters.sh` | [VPS] Create `tenant-a` / `tenant-b`, inject demo Pods and CRDs |
| `scripts/03-verify.sh` | [VPS] Verify the 3 types of isolation |
| `scripts/smoke-test.sh` | [Local] e2e that ties the above together over SSH |
| `scripts/teardown.sh` | [Local] Teardown (with `--delete-server` also destroys VPS) |
| `manifests/` | Sample CRDs / CRs / demo Pods |

## References

- vCluster docs: https://www.vcluster.com/docs
- conoha-cli: https://github.com/crowdy/conoha-cli
