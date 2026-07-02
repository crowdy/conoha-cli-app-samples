# vcluster サンプル 設計仕様 (Design Spec)

- **Issue**: [#111 feat: vcluster サンプル — ConoHa VPS 上で仮想 Kubernetes クラスタ (vCluster) をマルチテナントで動かす](https://github.com/crowdy/conoha-cli-app-samples/issues/111)
- **Date**: 2026-07-02
- **Status**: Approved (design)

## 1. 目的 (Motivation)

ConoHa VPS 上に軽量 Kubernetes (k3s) を導入し、その上で [vCluster](https://github.com/loft-sh/vcluster) (loft-sh, Apache-2.0) を用いて「1 つの VPS 内に複数の隔離された仮想 Kubernetes クラスタ」を体験できるサンプルを追加する。

- テナントごとにコントロールプレーンを隔離しつつ、ノード（データプレーン）はホストと共有する vCluster の本来の使い方を、素直に見せる。
- 現状このリポジトリには k8s / クラウドネイティブ系サンプルが 1 つも無いため、conoha-cli で k8s を触りたい層の入口とする。

## 2. スコープ (Scope)

このサンプルで対応する範囲:

- `vcluster/` サンプルディレクトリ新設
- k3s セットアップスクリプト（`curl -sfL https://get.k3s.io | sh -` ベース、host クラスタ用）
- vcluster CLI インストールスクリプト
- 仮想クラスタを 2 つ作成（`tenant-a` / `tenant-b`）+ それぞれへ `vcluster connect`
- 隔離の実証ワークロード（下記 §6）を verify スクリプトで自動検証
- teardown スクリプト（`vcluster delete` + k3s uninstall）
- README（ja / en / ko の 3 ファイル）
- 実 VPS で `conoha server create` 経由の e2e smoke test
- Qiita / ブログ用ドラフト（`docs/blogs/vcluster.md`）

### スコープ外 (Out of scope)

- k3d (k3s in docker) を compose で起動する B 案（Issue で不採用）
- LoadBalancer / Ingress を用いた本格的な外部公開構成（NodePort 外部公開は README で注意付きで案内するのみ）
- マルチノード k3s クラスタ（本サンプルはシングルノード）

## 3. アプローチ決定 (Decisions)

Issue で「着手時に判断」とされた項目を以下に確定する。

| 項目 | 決定 | 理由 |
|------|------|------|
| 構成 | **A 案: k3s on host + vcluster** | vCluster 本来の使い方（ホスト k8s 上に仮想クラスタ）をそのまま見せられる。Issue 推奨。 |
| デプロイ手段 | **純 scripts + `conoha server create`** | compose/conoha.yml に乗らない。`line-cli-go` / `vllm-gpu` と同じ non-compose の位置づけ。 |
| アクセス / 検証 | **SSH 内部で `vcluster connect` + `verify.sh` 自動検証** | クラウド VPS には LoadBalancer が無い。外部露出せず最も安全で、e2e smoke test にそのまま使える。 |
| README 多言語 | **ja / en / ko の 3 ファイルすべて** | Issue 要求。vllm-gpu と同じ 3 ファイル構成。 |
| ブログ | **本プランに含む**（検証完了後に着手） | Issue 最終チェックボックス。 |
| フレーバー | **g2l-t-4 (4GB) 推奨 / 最小 g2l-t-2 (2GB)**、GPU 不要 | Issue 推奨。k3s + vcluster 2〜3 個なら 2〜4GB で足りる。 |

## 4. ディレクトリ構成 (Directory Layout)

```
vcluster/
├── README.md                  # ja (main)
├── README-en.md               # en
├── README-ko.md               # ko
├── .env.example               # SERVER_NAME / FLAVOR=g2l-t-4 / IMAGE / SSH_KEY_NAME など
├── scripts/
│   ├── 00-provision.sh        # [local] conoha server create + SSH 到達待ち、IP を出力
│   ├── 01-setup-host.sh       # [on VPS] k3s + kubectl + helm + vcluster CLI 導入
│   ├── 02-create-vclusters.sh # [on VPS] tenant-a / tenant-b 作成 + connect
│   ├── 03-verify.sh           # [on VPS] 隔離 3 種を自動検証、失敗時 non-zero exit
│   ├── smoke-test.sh          # [local] 00→03 を SSH でオーケストレーション (e2e)
│   └── teardown.sh            # vcluster delete + k3s-uninstall (+ オプションで conoha server delete)
└── manifests/
    ├── tenant-a-crd.yaml      # tenant-a にのみ入れるサンプル CRD (例: CronTab)
    ├── tenant-a-cr.yaml       # その CRD のインスタンス
    └── demo-pod.yaml          # 各テナントに置くワークロード (nginx) — host ノードスケジュール実証用
```

ブログドラフトはリポジトリ慣習に従い `docs/blogs/vcluster.md` に配置する。

### スクリプトの実行場所

- **[local]** = 作業者の手元（conoha-cli がある環境）で実行。
- **[on VPS]** = プロビジョニングした VPS 上で実行。`smoke-test.sh` が `scp` + `ssh` で転送・実行する。

## 5. コンポーネントと責務 (Components)

| ファイル | 責務 | 入力 | 出力 / 副作用 |
|----------|------|------|----------------|
| `00-provision.sh` | VPS 作成と SSH 到達確認 | `.env`（FLAVOR, IMAGE, SSH_KEY_NAME, SERVER_NAME） | サーバ作成、IP を stdout / 環境ファイルに出力 |
| `01-setup-host.sh` | host k3s と各種 CLI 導入 | （なし。VPS 上でルート実行） | k3s 起動、`kubectl`/`helm`/`vcluster` インストール、`~/.kube/config` 設定 |
| `02-create-vclusters.sh` | 仮想クラスタ 2 個作成 | k3s が稼働中であること | `tenant-a` / `tenant-b` namespace + 仮想クラスタ、各 kubeconfig context |
| `03-verify.sh` | 隔離 3 種の assert | tenant-a/b が稼働中 | 検証結果を stdout、失敗時 exit≠0 |
| `smoke-test.sh` | e2e オーケストレーション | `.env` | 00→03 を順に実行し総合判定 |
| `teardown.sh` | 後片付け | （なし） | vcluster delete、k3s uninstall、オプションで server delete |

各スクリプトは単独でも意味を持ち、`smoke-test.sh` はそれらを SSH 経由で束ねる薄いオーケストレータとする。

## 6. 隔離の実証 (Isolation Verification — サンプルの肝)

`03-verify.sh` は以下 3 点を実際にコマンドで確認し、すべて assert する（1 つでも崩れたら non-zero exit）。

1. **CRD の隔離**
   - `tenant-a` に `manifests/tenant-a-crd.yaml` を適用。
   - `tenant-a` の context で `kubectl get crd` に当該 CRD が **在る** ことを確認。
   - `tenant-b` の context と **host** の `kubectl get crd` に当該 CRD が **無い** ことを確認。

2. **cluster-admin の隔離**
   - `tenant-a` 内では cluster-admin 相当でも、host の実ノード / host のシステム namespace（例: host 側 `kube-system` の実 Pod）に **触れない / 見えない** ことを確認。
   - 具体: `tenant-a` の kubectl から host 固有リソースが列挙されないことを assert。

3. **host ノードの共有**
   - `tenant-a` / `tenant-b` にそれぞれ `manifests/demo-pod.yaml`（nginx）を配置。
   - host 側 `kubectl get pods -A` で、syncer 経由の実 Pod（vcluster プレフィックス付き）が **同一ノード** にスケジュールされていることを確認。

## 7. アクセス方法の注意 (Cloud VPS 特有 — README 記載)

- クラウド VPS には LoadBalancer が無い → 既定は **`vcluster connect`（内蔵 port-forward）** を用いる（本サンプルの検証もこれを使用）。
- 外部からアクセスしたい場合は **NodePort** を使う方法を README に別セクションで案内する。その際は **firewall / security group を必ず締める** ことを強く警告する。
- ストレージは k3s の `local-path-provisioner` が既定で使えるため PVC もそのまま動く旨を記載。

## 8. テスト戦略 (Testing)

- **e2e smoke test**: `scripts/smoke-test.sh` が実 VPS で `conoha server create` → setup → create → verify を SSH で完走する。他サンプルと同じ深さ。
  - 実行には ConoHa の認証情報と課金が発生する。検証フェーズで最低 1 回、実 VPS に対して実行して成功を確認する。
- **teardown 検証**: `teardown.sh` 実行後に vcluster / k3s が消えていることを確認し、`conoha server delete` まで含めてクリーンな状態に戻せることを確認する。

## 9. ドキュメント (Documentation)

- `vcluster/README.md` (ja) / `README-en.md` / `README-ko.md`。内容:
  - 背景（vCluster とは、テナント隔離の意義）。
  - 類似アプローチとの比較を一言: Kamaji (Clastix) / k0smotron (Mirantis) =「ホスティッドコントロールプレーン」型、Capsule (Clastix) =「namespace 隔離」型、vCluster =「namespace 内の仮想コントロールプレーン」型でこの 3 系統の中間。
  - 前提（フレーバー g2l-t-4 推奨 / 最小 g2l-t-2、GPU 不要）。
  - 手順（00→03 の実行方法、SSH の流れ）。
  - 隔離デモの見せ方（§6 の 3 点）。
  - アクセス方法の注意（§7、NodePort 外部公開の警告）。
  - teardown 手順。
- リポジトリ top-level `README.md` のサンプル一覧表に `vcluster` 行を追加（non-compose・`conoha.yml` 無しである旨を明記）。
- `docs/blogs/vcluster.md`: Qiita / ブログ用ドラフト（検証完了後に着手）。

## 10. セキュリティ / リポジトリ慣習 (Security / Conventions)

- `.env.example` のみコミットし、実 `.env` は gitignore（gitleaks CI 準拠）。秘密情報・鍵はコミットしない。
- README で NodePort 外部公開時の firewall / security group 締めを警告。
- 既存 non-compose サンプル（`vllm-gpu` / `line-cli-go`）の README 構成・スクリプト配置慣習に倣う。
