> 日本語 | [English](README-en.md) | [한국어](README-ko.md)

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

- **`g2l-t-c4m4` (4 vCPU / 4GB) 推奨** / 最小 `g2l-t-c3m2` (3 vCPU / 2GB)。k3s + vcluster 2〜3 個なら 2〜4GB で足ります。**GPU 不要**。
- フレーバー名・イメージ名はリージョンや時期により異なります。`conoha flavor list` および `conoha image list` で確認してください。

## 前提

- `conoha` CLI がセットアップ済み（[conoha-cli](https://github.com/crowdy/conoha-cli)）。
- ConoHa に SSH キーペアを登録済み（`conoha keypair list` で確認できる名前を控える）。
- 手元に `git` / `bash` / `python3`。
- SSH (ポート 22) を開けたセキュリティグループが必要です。`00-provision.sh` はデフォルトで `default IPv4v6-SSH` をアタッチします（`SECURITY_GROUPS` 環境変数で変更可能）。
- 新規 VPS のホストキーは `00-provision.sh` が `ssh-keyscan` で自動登録するため、`conoha server ssh` による非対話 SSH が動作します。

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
