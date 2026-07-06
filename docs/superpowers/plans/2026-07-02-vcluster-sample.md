# vcluster サンプル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ConoHa VPS 上に k3s + vCluster を導入し、1 台の VPS 内で 2 つの隔離された仮想 Kubernetes クラスタ (`tenant-a` / `tenant-b`) を作成・隔離実証・撤去できる scripts + README 主体のサンプル `vcluster/` を追加する。

**Architecture:** `conoha server create` で小型 VPS を作り、`conoha server ssh` で k3s（ホストクラスタ）と vcluster CLI を導入、その上に 2 つの仮想クラスタを立てる。既存の `dokploy` サンプル（`conoha app deploy` を使わず `server create` + `server ssh` + インストールスクリプトで完結）と同じ non-compose 構成。`compose.yml` / `conoha.yml` は持たない。

**Tech Stack:** ConoHa VPS3 (conoha-cli), k3s (軽量 Kubernetes), vCluster (loft-sh, Apache-2.0), Bash, kubectl。

## Global Constraints

- 構成は Issue #111 の **A 案**（k3s on host + vcluster）。B 案（k3d in compose）は不採用。
- `vcluster/` は **`compose.yml` / `conoha.yml` を持たない**（`dokploy` と同じ non-compose サンプル）。
- 秘密情報はコミット禁止。`.env.example` のみコミットし、実 `.env` は `.gitignore` 対象（gitleaks CI 準拠、`CONTRIBUTING.md`）。
- README は **`README.md` (ja) / `README-en.md` (en) / `README-ko.md` (ko)** の 3 ファイル（`vllm-gpu` と同じ命名）。
- 推奨フレーバー **`g2l-t-4` (4GB)** / 最小 `g2l-t-2` (2GB)、**GPU 不要**。
- バージョン再現性のため k3s / vcluster はデフォルトのバージョンを固定し、環境変数で上書き可能にする（`dokploy` の `DOKPLOY_VERSION` 固定と同じ思想）。デフォルト: `K3S_VERSION=v1.31.5+k3s1`、`VCLUSTER_VERSION=v0.24.1`。
- 仮想クラスタの namespace は `tenant-a` → `team-a`、`tenant-b` → `team-b`（vcluster はインストール先 namespace に Pod を同期する = host 側で同 namespace を見れば同期実 Pod が見える）。
- ConoHa VPS のデフォルトユーザは非 root 想定。特権が要る箇所は `sudo` を明示（`dokploy` の `sudo -E` と同様）。k3s は `--write-kubeconfig-mode 644` で導入し、非 root からも `KUBECONFIG=/etc/rancher/k3s/k3s.yaml` を読めるようにする。
- クラウド VPS には LoadBalancer が無い。既定アクセス/検証は **`vcluster connect ... -- <cmd>`（内蔵 port-forward）**。NodePort 外部公開は README で firewall/security group 警告付きの別セクションとして案内するのみ。
- コマンドは現行 CLI 名 `conoha server create` / `conoha server delete --delete-boot-volume --yes` を用いる。
- スクリプトはすべて `set -euo pipefail` を先頭に置く。

### テスト方針（本サンプル固有）

本サンプルの成果物はインフラ用 Bash スクリプトであり、pytest 的な単体テストは馴染まない。各スクリプトの「テスト」は次の 2 段で行う:

1. **静的チェック**: `bash -n <script>`（構文）と、可能なら `shellcheck <script>`（未インストールなら skip 可）。
2. **行動テスト**: `03-verify.sh` が隔離 3 種を assert する検証ハーネスそのものであり、`scripts/smoke-test.sh` による **実 VPS e2e** が最終的な行動テストになる（Task 11）。

各スクリプト作成タスクは「スクリプトを書く → `bash -n` / `shellcheck` が通る → commit」を 1 サイクルとする。

---

### Task 1: サンプルの土台（ディレクトリ・env・manifests・gitignore）

**Files:**
- Create: `vcluster/.env.example`
- Create: `vcluster/manifests/tenant-a-crd.yaml`
- Create: `vcluster/manifests/tenant-a-cr.yaml`
- Create: `vcluster/manifests/demo-pod.yaml`
- Modify: `.gitignore`（`.env` 系と `.artifacts/` が無視されているか確認、無ければ追記）

**Interfaces:**
- Produces: 後続の全スクリプトが読む環境変数の契約（`.env.example`）と、`02`/`03` スクリプトが `kubectl apply -f` する manifests のパス。
  - env: `SERVER_NAME`(既定 `vcluster-host`), `FLAVOR`(既定 `g2l-t-4`), `IMAGE`(既定 `ubuntu-24.04`), `KEY_NAME`, `K3S_VERSION`(既定 `v1.31.5+k3s1`), `VCLUSTER_VERSION`(既定 `v0.24.1`), `TENANT_A_NS`(既定 `team-a`), `TENANT_B_NS`(既定 `team-b`), `REPO_URL`(既定 `https://github.com/crowdy/conoha-cli-app-samples`), `REPO_BRANCH`(既定 `main`)。
  - manifests: `manifests/tenant-a-crd.yaml`（`crontabs.stable.example.com` CRD）, `manifests/tenant-a-cr.yaml`（その CR インスタンス）, `manifests/demo-pod.yaml`（nginx Pod、`labels: app=demo`）。

- [ ] **Step 1: `.env.example` を作成**

```bash
# vcluster/.env.example
# Copy to .env and adjust. Never commit .env (see .gitignore / CONTRIBUTING.md).

# --- ConoHa server ---
SERVER_NAME=vcluster-host
FLAVOR=g2l-t-4          # 4GB recommended. Minimum g2l-t-2 (2GB). No GPU required.
IMAGE=ubuntu-24.04
KEY_NAME=mykey          # name of an SSH keypair registered in ConoHa (conoha keypair list)

# --- Versions (pinned for reproducibility; override if you like) ---
K3S_VERSION=v1.31.5+k3s1
VCLUSTER_VERSION=v0.24.1

# --- Virtual cluster namespaces on the host ---
TENANT_A_NS=team-a
TENANT_B_NS=team-b

# --- Source repo (scripts + manifests are pulled onto the VPS from here) ---
REPO_URL=https://github.com/crowdy/conoha-cli-app-samples
REPO_BRANCH=main
```

- [ ] **Step 2: サンプル CRD manifest を作成**

```yaml
# vcluster/manifests/tenant-a-crd.yaml
# A CRD installed ONLY inside tenant-a. Used to prove CRD isolation:
# it must NOT appear in tenant-b or on the host cluster.
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: crontabs.stable.example.com
spec:
  group: stable.example.com
  scope: Namespaced
  names:
    plural: crontabs
    singular: crontab
    kind: CronTab
    shortNames:
      - ct
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                cronSpec:
                  type: string
                image:
                  type: string
```

- [ ] **Step 3: CR インスタンス manifest を作成**

```yaml
# vcluster/manifests/tenant-a-cr.yaml
apiVersion: stable.example.com/v1
kind: CronTab
metadata:
  name: demo-crontab
spec:
  cronSpec: "* * * * */5"
  image: busybox
```

- [ ] **Step 4: demo Pod manifest を作成**

```yaml
# vcluster/manifests/demo-pod.yaml
# A workload deployed into each virtual cluster. Used to prove that pods
# from both tenants are synced to the SAME host node via the vcluster syncer.
apiVersion: v1
kind: Pod
metadata:
  name: demo
  labels:
    app: demo
spec:
  containers:
    - name: nginx
      image: nginx:1.27-alpine
      ports:
        - containerPort: 80
```

- [ ] **Step 5: `.gitignore` を確認・補強**

Run: `grep -nE '(^|/)\.env|\.artifacts' .gitignore`
Expected: `.env` 系が既に無視されているはず（`CONTRIBUTING.md` 記載）。`.artifacts/` が無ければ末尾に追記:

```gitignore
.artifacts/
```

（`.env` 系が既に存在すれば重複追記しない。）

- [ ] **Step 6: 静的チェック**

Run: `python3 -c 'import yaml,sys; [list(yaml.safe_load_all(open(f))) for f in ["vcluster/manifests/tenant-a-crd.yaml","vcluster/manifests/tenant-a-cr.yaml","vcluster/manifests/demo-pod.yaml"]]; print("yaml ok")'`
Expected: `yaml ok`

- [ ] **Step 7: Commit**

```bash
git add vcluster/.env.example vcluster/manifests .gitignore
git commit -m "feat(vcluster): scaffold sample with env template and demo manifests"
```

---

### Task 2: ホストセットアップスクリプト `01-setup-host.sh`

**Files:**
- Create: `vcluster/scripts/01-setup-host.sh`

**Interfaces:**
- Consumes: env `K3S_VERSION`, `VCLUSTER_VERSION`（未設定なら Task 1 の既定値をスクリプト内デフォルトで補完）。VPS 上で実行される。
- Produces: 稼働中の k3s、`/usr/local/bin/kubectl`（k3s へのシンボリックリンク）、`/usr/local/bin/vcluster`、`KUBECONFIG=/etc/rancher/k3s/k3s.yaml`（mode 644）。冪等（再実行しても壊れない）。

- [ ] **Step 1: スクリプトを作成**

```bash
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
for i in $(seq 1 60); do
  if kubectl get nodes 2>/dev/null | grep -q ' Ready '; then break; fi
  sleep 5
done
kubectl get nodes

echo "==> Installing vcluster CLI ${VCLUSTER_VERSION}"
if ! command -v vcluster >/dev/null 2>&1 || \
   [ "$(vcluster --version 2>/dev/null | grep -o "${VCLUSTER_VERSION#v}" || true)" = "" ]; then
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
```

- [ ] **Step 2: 静的チェック**

Run: `bash -n vcluster/scripts/01-setup-host.sh && { command -v shellcheck >/dev/null && shellcheck vcluster/scripts/01-setup-host.sh || echo "shellcheck not installed, skipped"; }`
Expected: 構文エラーなし。shellcheck があれば警告ゼロ（未使用変数等が出たら修正）。

- [ ] **Step 3: 実行ビットを付与**

Run: `chmod +x vcluster/scripts/01-setup-host.sh`

- [ ] **Step 4: Commit**

```bash
git add vcluster/scripts/01-setup-host.sh
git commit -m "feat(vcluster): add host setup script (k3s + kubectl + vcluster CLI)"
```

---

### Task 3: 仮想クラスタ作成スクリプト `02-create-vclusters.sh`

**Files:**
- Create: `vcluster/scripts/02-create-vclusters.sh`

**Interfaces:**
- Consumes: env `TENANT_A_NS`(既定 `team-a`), `TENANT_B_NS`(既定 `team-b`), `KUBECONFIG`（`01` が設定する host kubeconfig）。VPS 上、`01-setup-host.sh` 実行後に走る。実行ディレクトリはリポジトリ内 `vcluster/`（manifests への相対参照のため）。
- Produces: host の `team-a` / `team-b` namespace に稼働する 2 つの仮想クラスタ（`tenant-a` / `tenant-b`）。各テナントに demo Pod が起動済み、tenant-a には CRD + CR も適用済み。

- [ ] **Step 1: スクリプトを作成**

```bash
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
  for i in $(seq 1 60); do
    if kubectl get pods -n "${ns}" 2>/dev/null | grep -E "^${name}-0" | grep -q 'Running'; then break; fi
    sleep 5
  done
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
```

- [ ] **Step 2: 静的チェック**

Run: `bash -n vcluster/scripts/02-create-vclusters.sh && { command -v shellcheck >/dev/null && shellcheck vcluster/scripts/02-create-vclusters.sh || echo "shellcheck skipped"; }`
Expected: 構文エラーなし、shellcheck 警告ゼロ。

- [ ] **Step 3: 実行ビットを付与**

Run: `chmod +x vcluster/scripts/02-create-vclusters.sh`

- [ ] **Step 4: Commit**

```bash
git add vcluster/scripts/02-create-vclusters.sh
git commit -m "feat(vcluster): add script to create tenant-a/tenant-b vclusters"
```

---

### Task 4: 隔離検証スクリプト `03-verify.sh`（サンプルの肝）

**Files:**
- Create: `vcluster/scripts/03-verify.sh`

**Interfaces:**
- Consumes: env `TENANT_A_NS`, `TENANT_B_NS`, `KUBECONFIG`。VPS 上、`02-create-vclusters.sh` 実行後に走る。
- Produces: 隔離 3 種を assert し、全て通れば `ALL ISOLATION CHECKS PASSED` を出力し exit 0。1 つでも失敗すれば該当メッセージを出して exit 1。これがサンプルの行動テスト。

- [ ] **Step 1: スクリプトを作成**

```bash
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
# A cluster-admin INSIDE tenant-a must not be able to see the host-only namespace.
if vk tenant-a "${TENANT_A_NS}" get namespace "${HOST_ONLY_NS}" >/dev/null 2>&1; then
  fail "tenant-a can see host namespace ${HOST_ONLY_NS} — isolation broken"
fi
ok "tenant-a cannot see host namespace ${HOST_ONLY_NS}"
# And tenant-a must not see the host's real node-level daemonsets etc. Check kube-system differs:
# the host has traefik/local-path-provisioner from k3s; tenant-a's kube-system does not.
if vk tenant-a "${TENANT_A_NS}" get pods -n kube-system 2>/dev/null | grep -q 'local-path-provisioner'; then
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
    | grep '^demo' | awk '{print $2}' | head -1)"
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
```

Note（実装者向け）: syncer が付与する同期 Pod 名／ラベルは vcluster バージョンで差異がありうる。Step の第3チェックは「名前が `demo` で始まる同期 Pod」で拾うフォールバックを持たせてある。実 VPS（Task 11）で `kubectl get pods -n team-a` の実際の出力を見て、必要なら jsonpath のセレクタを実出力に合わせて微修正すること。

- [ ] **Step 2: 静的チェック**

Run: `bash -n vcluster/scripts/03-verify.sh && { command -v shellcheck >/dev/null && shellcheck vcluster/scripts/03-verify.sh || echo "shellcheck skipped"; }`
Expected: 構文エラーなし、shellcheck 警告ゼロ。

- [ ] **Step 3: 実行ビットを付与**

Run: `chmod +x vcluster/scripts/03-verify.sh`

- [ ] **Step 4: Commit**

```bash
git add vcluster/scripts/03-verify.sh
git commit -m "feat(vcluster): add isolation verification script (CRD/admin/node-sharing)"
```

---

### Task 5: プロビジョニングスクリプト `00-provision.sh`（local）

**Files:**
- Create: `vcluster/scripts/00-provision.sh`

**Interfaces:**
- Consumes: `.env`（`SERVER_NAME`, `FLAVOR`, `IMAGE`, `KEY_NAME`）。作業者の手元で実行。`conoha` CLI が PATH にあること。
- Produces: ACTIVE な VPS。SSH 到達を確認後、サーバ IP を stdout に出力（`SERVER_IP=...` 形式）。冪等（同名サーバが既にあれば作成をスキップ）。

- [ ] **Step 1: スクリプトを作成**

```bash
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
```

Note（実装者向け）: `conoha server show --format json` のフィールド（`status` / `addresses[].addr`）は他サンプルのプラン（`hunyuan3d-gpu`）で使われている実績のある形。実 CLI 出力と差異があれば Task 11 の初回実行で確認して調整すること。

- [ ] **Step 2: 静的チェック**

Run: `bash -n vcluster/scripts/00-provision.sh && { command -v shellcheck >/dev/null && shellcheck vcluster/scripts/00-provision.sh || echo "shellcheck skipped"; }`
Expected: 構文エラーなし、shellcheck 警告ゼロ。

- [ ] **Step 3: 実行ビットを付与**

Run: `chmod +x vcluster/scripts/00-provision.sh`

- [ ] **Step 4: Commit**

```bash
git add vcluster/scripts/00-provision.sh
git commit -m "feat(vcluster): add local provisioning script (conoha server create)"
```

---

### Task 6: e2e オーケストレータ `smoke-test.sh`（local）

**Files:**
- Create: `vcluster/scripts/smoke-test.sh`

**Interfaces:**
- Consumes: `.env`（Task 1 の全変数）。作業者の手元で実行。`00-provision.sh` を呼び、VPS 上でリポジトリを clone して `01`→`02`→`03` を SSH 経由で順に実行する。
- Produces: 全段成功で `SMOKE TEST PASSED` を出力し exit 0。どこかで失敗すれば非ゼロ。サーバの作成/削除はしない（削除は `teardown.sh` の責務。作成は `00-provision.sh` に委譲）。

- [ ] **Step 1: スクリプトを作成**

```bash
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
```

- [ ] **Step 2: 静的チェック**

Run: `bash -n vcluster/scripts/smoke-test.sh && { command -v shellcheck >/dev/null && shellcheck vcluster/scripts/smoke-test.sh || echo "shellcheck skipped"; }`
Expected: 構文エラーなし、shellcheck 警告ゼロ。

- [ ] **Step 3: 実行ビットを付与**

Run: `chmod +x vcluster/scripts/smoke-test.sh`

- [ ] **Step 4: Commit**

```bash
git add vcluster/scripts/smoke-test.sh
git commit -m "feat(vcluster): add e2e smoke-test orchestrator"
```

---

### Task 7: 撤去スクリプト `teardown.sh`

**Files:**
- Create: `vcluster/scripts/teardown.sh`

**Interfaces:**
- Consumes: `.env`（`SERVER_NAME`, `TENANT_A_NS`, `TENANT_B_NS`）。作業者の手元で実行。
- Produces: 2 段階の撤去。既定は VPS 上の `vcluster delete` + k3s uninstall のみ。`--delete-server` を渡すと `conoha server delete <name> --delete-boot-volume --yes` まで実行して VPS ごと破棄する。

- [ ] **Step 1: スクリプトを作成**

```bash
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
  conoha server list | grep -q "${SERVER_NAME}" && echo "WARNING: server still listed" || echo "destroyed cleanly"
else
  echo "==> Kept the VPS. Re-run with --delete-server to destroy it."
fi
```

- [ ] **Step 2: 静的チェック**

Run: `bash -n vcluster/scripts/teardown.sh && { command -v shellcheck >/dev/null && shellcheck vcluster/scripts/teardown.sh || echo "shellcheck skipped"; }`
Expected: 構文エラーなし、shellcheck 警告ゼロ。

- [ ] **Step 3: 実行ビットを付与**

Run: `chmod +x vcluster/scripts/teardown.sh`

- [ ] **Step 4: Commit**

```bash
git add vcluster/scripts/teardown.sh
git commit -m "feat(vcluster): add teardown script (vcluster delete + k3s uninstall + optional server delete)"
```

---

### Task 8: `README.md`（ja, メイン）

**Files:**
- Create: `vcluster/README.md`

**Interfaces:**
- Consumes: 全スクリプトと manifests（手順として参照）。
- Produces: 日本語のメインドキュメント。他タスクの en/ko はこれを翻訳する原本。

- [ ] **Step 1: README.md を作成**

以下の全内容を `vcluster/README.md` に書く（プレースホルダなし・完全版）:

````markdown
# vcluster — ConoHa VPS 上で仮想 Kubernetes クラスタをマルチテナントで動かす

[vCluster](https://github.com/loft-sh/vcluster)（loft-sh, Apache-2.0）は、ホスト Kubernetes クラスタの **1 つの namespace の中に「独自 API サーバを持つ仮想 k8s クラスタ」** を立てる OSS です。コントロールプレーンはテナントごとに隔離しつつ、ノード（データプレーン）はホストと共有するため、

- テナントに **cluster-admin を渡しても安全**（自分の仮想クラスタの中だけ）
- テナントごとに **独自 CRD / API バージョン / クラスタスコープリソース**が持てる
- 実クラスタを複数立てるより **軽量・数秒で生成**

というマルチテナンシーの有力解です。

このサンプルは、素の Linux ボックスである ConoHa VPS に **k3s（軽量シングルノード k8s）** を入れ、その上に **vCluster で 2 つの隔離された仮想クラスタ（`tenant-a` / `tenant-b`）** を立て、隔離を実際のコマンドで実証します。GPU は不要です。

> このサンプルは `dokploy` と同じく **`conoha app deploy` を使わない** non-compose サンプルです。`compose.yml` / `conoha.yml` は持たず、`conoha server create` + `conoha server ssh` + スクリプトで完結します。

## 類似アプローチとの位置づけ

- **Kamaji (Clastix) / k0smotron (Mirantis)**: 「ホスティッドコントロールプレーン」型
- **Capsule (Clastix)**: 「namespace 隔離」型
- **vCluster**: 「namespace 内の仮想コントロールプレーン」型 — この 3 系統の中間に位置し、テナントに cluster-admin と独自 CRD を安全に渡せるのが特徴。

## 推奨フレーバー

- **`g2l-t-4` (4GB) 推奨** / 最小 `g2l-t-2` (2GB)。k3s + vcluster 2〜3 個なら 2〜4GB で足ります。**GPU 不要**。

## 前提

- `conoha` CLI がセットアップ済み（[conoha-cli](https://github.com/crowdy/conoha-cli)）。
- ConoHa に SSH キーペアを登録済み（`conoha keypair list` で確認できる名前を控える）。
- 手元に `git` / `bash` / `python3`。

## クイックスタート（自動 e2e）

```bash
cd vcluster
cp .env.example .env
# .env の KEY_NAME を自分のキーペア名に、必要なら SERVER_NAME/FLAVOR を編集

# 作成 → k3s+vcluster 導入 → 仮想クラスタ2つ作成 → 隔離検証 まで一気に実行
bash scripts/smoke-test.sh
```

最後に `SMOKE TEST PASSED` が出れば、VPS 上で 2 つの隔離された仮想クラスタが動き、隔離 3 種が検証済みです。

## 手動手順（各ステップを理解しながら）

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

## 隔離の実証（このサンプルの肝）

`scripts/03-verify.sh` は以下を実コマンドで確認し、すべて満たされたときだけ成功します。

1. **CRD の隔離** — `tenant-a` に入れた CRD（`crontabs.stable.example.com`）が、`tenant-b` からも host からも見えない。
2. **cluster-admin の隔離** — `tenant-a` 内の cluster-admin でも、host に直接作った namespace（`host-only-ns`）や host の k3s システム Pod（`local-path-provisioner`）には触れない／見えない。
3. **host ノードの共有** — 両テナントのデモ Pod が、syncer 経由で host の **同じノード** にスケジュールされる。host 側で確認できる:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get pods -n team-a -o wide   # tenant-a の同期実 Pod
kubectl get pods -n team-b -o wide   # tenant-b の同期実 Pod（同じ NODE 列になる）
```

## 仮想クラスタへの接続

クラウド VPS には LoadBalancer が無いため、既定は vCluster 内蔵の port-forward を使います。

```bash
# VPS 上で対話的に tenant-a の kubectl を使う
vcluster connect tenant-a --namespace team-a
# 別ターミナルで:
kubectl get pods -A     # tenant-a から見た「自分専用クラスタ」
# 終了:
vcluster disconnect
```

ストレージは k3s の `local-path-provisioner` が既定で使えるので、各仮想クラスタで PVC もそのまま動きます。

## 外部からアクセスしたい場合（NodePort）— 要注意

外部の kubectl から直接叩きたい場合は NodePort で公開できますが、**API サーバを素で外部公開するのは危険**です。必ず ConoHa のセキュリティグループ／ファイアウォールで接続元 IP を絞ってください。

```bash
# 例: tenant-a の API を NodePort で公開（アクセス元を絞ったうえで）
vcluster connect tenant-a --namespace team-a --expose   # LoadBalancer/NodePort 経由の kubeconfig を生成
```

> セキュリティグループを開けたまま放置しないこと。検証が終わったら閉じるか、`teardown.sh --delete-server` で VPS ごと破棄してください。

## 撤去

```bash
# 仮想クラスタ削除 + k3s アンインストール（VPS は残す）
bash scripts/teardown.sh

# VPS ごと破棄（ブートボリュームも削除）
bash scripts/teardown.sh --delete-server
```

## 構成ファイル

| ファイル | 役割 |
|----------|------|
| `scripts/00-provision.sh` | [ローカル] `conoha server create` + SSH 到達待ち |
| `scripts/01-setup-host.sh` | [VPS] k3s + kubectl + vcluster CLI 導入 |
| `scripts/02-create-vclusters.sh` | [VPS] `tenant-a` / `tenant-b` 作成、デモ Pod・CRD 投入 |
| `scripts/03-verify.sh` | [VPS] 隔離 3 種を検証 |
| `scripts/smoke-test.sh` | [ローカル] 上記を SSH で束ねる e2e |
| `scripts/teardown.sh` | [ローカル] 撤去（`--delete-server` で VPS も破棄） |
| `manifests/` | サンプル CRD / CR / デモ Pod |

## 参考

- vCluster docs: https://www.vcluster.com/docs
- conoha-cli: https://github.com/crowdy/conoha-cli
````

- [ ] **Step 2: リンク・整合チェック**

Run: `grep -c 'scripts/' vcluster/README.md`
Expected: 1 以上（構成表とクイックスタートでスクリプトを参照している）。スクリプト名が Task 2〜7 と一致していることを目視確認。

- [ ] **Step 3: Commit**

```bash
git add vcluster/README.md
git commit -m "docs(vcluster): add Japanese README"
```

---

### Task 9: `README-en.md` と `README-ko.md`

**Files:**
- Create: `vcluster/README-en.md`
- Create: `vcluster/README-ko.md`

**Interfaces:**
- Consumes: `vcluster/README.md`（原本）。
- Produces: 英語版・韓国語版。見出し構成・コマンド・ファイル名は ja と完全一致させ、本文のみ翻訳する。

- [ ] **Step 1: `README-en.md` を作成**

`README.md` の全セクション（タイトル、位置づけ、推奨フレーバー、前提、クイックスタート、手動手順、隔離の実証、接続、NodePort 注意、撤去、構成ファイル表、参考）を英語に翻訳する。**コードブロック内のコマンド・ファイル名・namespace 名（team-a/team-b, tenant-a/tenant-b）は変更しない。** 冒頭に他言語へのリンクを付ける:

```markdown
> [日本語](README.md) | English | [한국어](README-ko.md)
```

- [ ] **Step 2: `README-ko.md` を作成**

同様に韓国語へ翻訳。冒頭リンク:

```markdown
> [日本語](README.md) | [English](README-en.md) | 한국어
```

ja の `README.md` 冒頭にも対応するリンク行を追記する:

```markdown
> 日本語 | [English](README-en.md) | [한국어](README-ko.md)
```

- [ ] **Step 3: 整合チェック**

Run: `for f in vcluster/README.md vcluster/README-en.md vcluster/README-ko.md; do echo "$f: $(grep -c '^## ' "$f") sections"; done`
Expected: 3 ファイルの `## ` セクション数が一致。

- [ ] **Step 4: Commit**

```bash
git add vcluster/README.md vcluster/README-en.md vcluster/README-ko.md
git commit -m "docs(vcluster): add English and Korean READMEs"
```

---

### Task 10: top-level README のサンプル一覧に追加

**Files:**
- Modify: `README.md`（リポジトリルート、サンプル一覧テーブル。`vllm-gpu` / `line-cli-go` の行の近く）

**Interfaces:**
- Consumes: なし。
- Produces: ルート README のテーブルに `vcluster` 行を 1 行追加。non-compose（`conoha.yml` 無し）であることを列で明示。

- [ ] **Step 1: 現在のテーブル行を確認**

Run: `grep -n '| \[line-cli-go\]\|| \[vllm-gpu\]\|conoha.yml を持たない' README.md`
Expected: 既存の行フォーマットを把握（`| [name](dir/) | Stack | 説明 | Flavor |` 形式）。

- [ ] **Step 2: `vcluster` 行を追加**

`vllm-gpu` 等 non-compose サンプルの並びに合わせて、テーブルへ以下の行を追記する（列構成は実ファイルの見出しに合わせること）:

```markdown
| [vcluster](vcluster/) | k3s + vCluster (loft-sh) | 1 台の VPS 上で 2 つの隔離された仮想 Kubernetes クラスタをマルチテナントで動かす（`conoha app deploy` 非使用の scripts 主体サンプル） | g2l-t-4 (4GB) |
```

non-compose 群の説明文（39 行目付近: 「`conoha.yml` を持たないため `--no-proxy`…」）に `vcluster` が該当する旨を、`dokploy` 同様に一言添える（`dokploy` が既に言及されていればその文に `vcluster` を並記）。

- [ ] **Step 3: 整合チェック**

Run: `grep -n 'vcluster' README.md`
Expected: 追加した行が表示される。

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: list vcluster sample in top-level README"
```

---

### Task 11: 実 VPS で e2e smoke test（検証）

> **課金注意:** このタスクは実際に ConoHa VPS を作成し、`conoha` の認証情報と課金が発生する。実行前にユーザへ確認する（`superpowers:verification-before-completion`）。

**Files:**
- Create: `.artifacts/vcluster-smoke.log`（ローカルのみ、gitignore 済み）

**Interfaces:**
- Consumes: Task 1〜7 の全スクリプト、有効な `.env`（実 `KEY_NAME`）。
- Produces: 実 VPS 上で `SMOKE TEST PASSED` を確認した証跡（ログ）。検証後は必ず VPS を破棄。

- [ ] **Step 1: 実行前ユーザ確認**

ユーザに「実 VPS を立てて e2e を回してよいか（課金発生）」を確認する。承認が無ければここで停止し、スクリプトの静的チェック済みである旨だけ報告する。

- [ ] **Step 2: `.env` を用意して smoke test を実行**

```bash
cd vcluster
cp -n .env.example .env   # 未作成なら
# .env の KEY_NAME を実キーペア名に設定してから:
mkdir -p ../.artifacts
bash scripts/smoke-test.sh 2>&1 | tee ../.artifacts/vcluster-smoke.log
```

Expected: 末尾に `SMOKE TEST PASSED`。

- [ ] **Step 3: 隔離の実 Pod をログに残す**

```bash
SERVER_NAME="$(. vcluster/.env; echo "$SERVER_NAME")"
conoha server ssh "$SERVER_NAME" -- bash -lc '
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
echo "=== host: team-a pods ==="; kubectl get pods -n team-a -o wide
echo "=== host: team-b pods ==="; kubectl get pods -n team-b -o wide
echo "=== host: crd (should NOT contain crontabs) ==="; kubectl get crd | grep crontab || echo "no crontab CRD on host (expected)"
' | tee -a .artifacts/vcluster-smoke.log
```

Expected: 両 namespace のデモ Pod が同じ NODE 列。host に crontab CRD が無い。

- [ ] **Step 4: 失敗時の調整**

`03-verify.sh` の第3チェック（同期 Pod の nodeName 取得）が実出力と合わなければ、`kubectl get pods -n team-a -o yaml` の実際の名前／ラベルに合わせて `vcluster/scripts/03-verify.sh` の jsonpath/grep を修正し、Task 4 の commit を追撃修正してから Step 2 を再実行する。

- [ ] **Step 5: VPS を破棄**

```bash
cd vcluster
bash scripts/teardown.sh --delete-server
```

Expected: `destroyed cleanly`。`conoha server list` に `vcluster-host` が出ないこと。

- [ ] **Step 6: 検証結果をコミット（スクリプト修正があった場合のみ）**

```bash
git add vcluster/scripts/03-verify.sh
git commit -m "fix(vcluster): align verify.sh selectors with real vcluster output"
```

（`.artifacts/` はコミットしない。）

---

### Task 12: Qiita / ブログ用ドラフト

**Files:**
- Create: `docs/blogs/vcluster.md`

**Interfaces:**
- Consumes: 完成したサンプルと Task 11 の検証証跡。
- Produces: リポジトリの `docs/blogs/*.md` 慣習（`vllm-gpu.md` 等）に倣った Qiita/ブログ用ドラフト。frontmatter（title/tags/author/slide）付き。

- [ ] **Step 1: 既存ブログの frontmatter 形式を確認**

Run: `sed -n '1,6p' docs/blogs/vllm-gpu.md`
Expected: `--- / title: / tags: / author: crowdy / slide: false / ---` 形式。

- [ ] **Step 2: ドラフトを作成**

`docs/blogs/vcluster.md` を作成。frontmatter を既存形式に合わせ、本文は次の流れで書く（`dokploy.md` の「なぜ app deploy を使わないか」の語り口を踏襲）:

1. はじめに — vCluster とは / マルチテナンシーの課題
2. なぜ `conoha app deploy` ではなく `server create` + `server ssh` なのか（k3s + vcluster は compose に乗らない）
3. 構成図（ローカル → VPS → k3s → tenant-a/tenant-b の ASCII 図）
4. 3 ステップ（`.env` → `smoke-test.sh` → 撤去）
5. 隔離の実証 3 種を実出力（Task 11 の `.artifacts/vcluster-smoke.log` から引用）
6. 類似 OSS（Kamaji / k0smotron / Capsule）との位置づけ
7. まとめ表（対象 / 使うコマンド / 推奨フレーバー / サンプルリンク）

frontmatter 例:

```markdown
---
title: conoha-cli で ConoHa VPS 上に「複数の隔離された仮想 Kubernetes クラスタ」を立てる — k3s + vCluster マルチテナント
tags: ConoHa conoha-cli Kubernetes vcluster k3s
author: crowdy
slide: false
---
```

- [ ] **Step 3: 静的チェック**

Run: `head -1 docs/blogs/vcluster.md`
Expected: `---`（frontmatter 開始）。本文中のコマンド・ファイル名がサンプル実体と一致することを目視確認。

- [ ] **Step 4: Commit**

```bash
git add docs/blogs/vcluster.md
git commit -m "docs(blogs): add vcluster sample walkthrough draft"
```

---

## Self-Review

**1. Spec coverage（スペック §2〜§10 と照合）:**
- `vcluster/` 新設 → Task 1。
- k3s セットアップ / vcluster CLI 導入 → Task 2。
- tenant-a/tenant-b 作成 + connect → Task 3（作成）+ 各スクリプトの `vcluster connect`。
- 隔離実証 3 種 → Task 4（`03-verify.sh`）、README §隔離 → Task 8。
- teardown → Task 7。
- README ja/en/ko → Task 8, 9。
- top-level README 追加 → Task 10。
- 実 VPS e2e smoke test → Task 6（スクリプト）+ Task 11（実行）。
- Qiita/ブログ → Task 12。
- アクセス注意（vcluster connect / NodePort / firewall）→ README §接続・§NodePort（Task 8）。
- local-path-provisioner / PVC 言及 → README（Task 8）。
- フレーバー g2l-t-4 → `.env.example`（Task 1）・README（Task 8）。
- 秘密情報・gitignore → Task 1 Step 5。
すべてのスペック項目に対応タスクあり。ギャップなし。

**2. Placeholder scan:** 各コード/コマンドステップは実内容を含む。README は完全版を Task 8 に記載。翻訳（Task 9）は原本参照だが「見出し・コマンドは一致、本文のみ訳す」と具体化済み。「TBD/後で」等なし。

**3. Type/naming consistency:** スクリプト名（`00-provision.sh` / `01-setup-host.sh` / `02-create-vclusters.sh` / `03-verify.sh` / `smoke-test.sh` / `teardown.sh`）、namespace（`team-a`/`team-b`）、テナント名（`tenant-a`/`tenant-b`）、CRD 名（`crontabs.stable.example.com`）、env 変数名、host-only-ns（`host-only-ns`）が全タスクで一致。`smoke-test.sh` が呼ぶスクリプト名も一致。バージョン既定（`v1.31.5+k3s1` / `v0.24.1`）が `.env.example`・各スクリプト・`smoke-test.sh` で一致。

（実 CLI / vcluster 出力に依存する箇所は Task 5/11 に「実出力に合わせて微修正」の明示ステップを置いてある。）
