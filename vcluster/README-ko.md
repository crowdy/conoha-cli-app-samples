> [日本語](README.md) | [English](README-en.md) | 한국어

# vcluster — ConoHa VPS에서 가상 Kubernetes 클러스터를 멀티 테넌트로 운영하기

[vCluster](https://github.com/loft-sh/vcluster) (loft-sh, Apache-2.0)는 호스트 Kubernetes 클러스터의 **하나의 네임스페이스 안에 "독자적인 API 서버를 가진 가상 k8s 클러스터"** 를 구성하는 OSS입니다. 컨트롤 플레인은 테넌트별로 격리하면서도 노드(데이터 플레인)는 호스트와 공유하므로,

- 테넌트에게 **cluster-admin을 부여해도 안전** (자신의 가상 클러스터 내부로만 한정)
- 테넌트별로 **독자 CRD / API 버전 / 클러스터 스코프 리소스**를 가질 수 있음
- 실제 클러스터를 여러 개 구성하는 것보다 **경량이고 수 초 만에 생성 가능**

이는 Kubernetes 멀티 테넌시의 유력한 해결책입니다.

이 샘플은 순수 Linux 서버인 ConoHa VPS에 **k3s(경량 싱글 노드 k8s)** 를 설치하고, 그 위에 **vCluster로 격리된 가상 클러스터 2개(`tenant-a` / `tenant-b`)** 를 구성하여 격리를 실제 커맨드로 실증합니다. GPU는 불필요합니다.

> 이 샘플은 `dokploy`와 마찬가지로 **`conoha app deploy`를 사용하지 않는** non-compose 샘플입니다. `compose.yml` / `conoha.yml`은 없으며, `conoha server create` + `conoha server ssh` + 스크립트로 완결됩니다.

## 유사 접근법과의 비교

- **Kamaji (Clastix) / k0smotron (Mirantis)**: "호스티드 컨트롤 플레인" 방식
- **Capsule (Clastix)**: "네임스페이스 격리" 방식
- **vCluster**: "네임스페이스 내 가상 컨트롤 플레인" 방식 — 이 세 계열의 중간에 위치하며, 테넌트에게 cluster-admin과 독자 CRD를 안전하게 부여할 수 있는 것이 특징.

## 권장 플레이버

- **`g2l-t-4` (4GB) 권장** / 최소 `g2l-t-2` (2GB). k3s + vcluster 2~3개라면 2~4GB로 충분합니다. **GPU 불필요**.

## 사전 준비

- `conoha` CLI 설정 완료 ([conoha-cli](https://github.com/crowdy/conoha-cli)).
- ConoHa에 SSH 키페어 등록 완료 (`conoha keypair list`에서 확인 가능한 이름을 메모해두기).
- 로컬에 `git` / `bash` / `python3` 설치.

## 퀵 스타트 (자동 e2e)

```bash
cd vcluster
cp .env.example .env
# .env の KEY_NAME を自分のキーペア名に、必要なら SERVER_NAME/FLAVOR を編集

# 作成 → k3s+vcluster 導入 → 仮想クラスタ2つ作成 → 隔離検証 まで一気に実行
bash scripts/smoke-test.sh
```

마지막에 `SMOKE TEST PASSED`가 출력되면, VPS에서 격리된 가상 클러스터 2개가 동작 중이며 격리 3종이 검증 완료된 것입니다.

## 수동 절차 (각 단계를 이해하면서)

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

## 격리 실증 (이 샘플의 핵심)

`scripts/03-verify.sh`는 아래 사항을 실제 커맨드로 확인하며, 모두 충족될 때만 성공합니다.

1. **CRD 격리** — `tenant-a`에 등록한 CRD(`crontabs.stable.example.com`)가 `tenant-b`에서도 host에서도 보이지 않음.
2. **cluster-admin 격리** — `tenant-a` 내의 cluster-admin으로도, host에 직접 생성한 네임스페이스(`host-only-ns`)나 host의 k3s 시스템 Pod(`local-path-provisioner`)에는 접근/조회 불가.
3. **host 노드 공유** — 양쪽 테넌트의 데모 Pod가 syncer를 통해 host의 **동일 노드**에 스케줄됨. host 측에서 확인 가능:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get pods -n team-a -o wide   # tenant-a の同期実 Pod
kubectl get pods -n team-b -o wide   # tenant-b の同期実 Pod（同じ NODE 列になる）
```

## 가상 클러스터 연결

클라우드 VPS에는 LoadBalancer가 없으므로, 기본값은 vCluster 내장 port-forward를 사용합니다.

```bash
# VPS 上で対話的に tenant-a の kubectl を使う
vcluster connect tenant-a --namespace team-a
# 別ターミナルで:
kubectl get pods -A     # tenant-a から見た「自分専用クラスタ」
# 終了:
vcluster disconnect
```

스토리지는 k3s의 `local-path-provisioner`가 기본으로 사용 가능하므로, 각 가상 클러스터에서 PVC도 그대로 동작합니다.

## 외부에서 접속하고 싶은 경우 (NodePort) — 주의사항

외부 kubectl에서 직접 접속하고 싶은 경우에는 NodePort로 공개할 수 있지만, **API 서버를 그대로 외부에 공개하는 것은 위험합니다**. 반드시 ConoHa의 보안 그룹/방화벽에서 접속 소스 IP를 제한해주세요.

```bash
# 例: tenant-a の API を NodePort で公開（アクセス元を絞ったうえで）
vcluster connect tenant-a --namespace team-a --expose   # LoadBalancer/NodePort 経由の kubeconfig を生成
```

> 보안 그룹을 열어둔 채 방치하지 마세요. 검증이 끝나면 닫거나, `teardown.sh --delete-server`로 VPS째 삭제하세요.

## 철거

```bash
# 仮想クラスタ削除 + k3s アンインストール（VPS は残す）
bash scripts/teardown.sh

# VPS ごと破棄（ブートボリュームも削除）
bash scripts/teardown.sh --delete-server
```

## 구성 파일

| 파일 | 역할 |
|------|------|
| `scripts/00-provision.sh` | [로컬] `conoha server create` + SSH 연결 대기 |
| `scripts/01-setup-host.sh` | [VPS] k3s + kubectl + vcluster CLI 설치 |
| `scripts/02-create-vclusters.sh` | [VPS] `tenant-a` / `tenant-b` 생성, 데모 Pod·CRD 투입 |
| `scripts/03-verify.sh` | [VPS] 격리 3종 검증 |
| `scripts/smoke-test.sh` | [로컬] 위 항목을 SSH로 묶은 e2e |
| `scripts/teardown.sh` | [로컬] 철거 (`--delete-server`로 VPS도 삭제) |
| `manifests/` | 샘플 CRD / CR / 데모 Pod |

## 참고

- vCluster docs: https://www.vcluster.com/docs
- conoha-cli: https://github.com/crowdy/conoha-cli
