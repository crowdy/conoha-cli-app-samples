---
title: conoha-cli で ConoHa VPS 上に「複数の隔離された仮想 Kubernetes クラスタ」を立てる — k3s + vCluster マルチテナント
tags: ConoHa conoha-cli Kubernetes vcluster k3s
author: crowdy
slide: false
---
## はじめに

Kubernetes クラスタを複数チームで共有するとき、「namespace を分ける」だけでは CRD や ClusterRole がクラスタ全体に漏れてしまいます。かといってチームごとに本物のクラスタを立てると台数が増えてコストがかさみます。この問題へのスマートな解が [vCluster](https://github.com/loft-sh/vcluster)（loft-sh, Apache-2.0）です。

**vCluster** は、ホスト Kubernetes クラスタの 1 つの namespace の中に「独自 API サーバを持つ仮想 k8s クラスタ」を立てる OSS です。コントロールプレーンはテナントごとに隔離しつつ、ノード（データプレーン）はホストと共有するため、

- テナントに **cluster-admin を渡しても安全**（自分の仮想クラスタの中だけ）
- テナントごとに **独自 CRD / API バージョン** が持てる
- 実クラスタを複数立てるより **軽量・数秒で生成**

というメリットがあります。

本記事では、ConoHa VPS に **k3s（軽量シングルノード k8s）** を入れ、その上に **vCluster で 2 つの隔離された仮想クラスタ（`tenant-a` / `tenant-b`）** を立て、隔離を実際のコマンド出力で実証します。GPU は不要で、フレーバーは **g2l-t-c4m4（4 vCPU / 4GB）** で十分です。

---

## なぜ `conoha app deploy` ではなく `server create` + `server ssh` なのか

このシリーズのほとんどのサンプル（WordPress / Next.js / Strapi など）は `conoha app deploy` ワンコマンドで完結します。`app deploy` は「`compose.yml` のあるディレクトリを VPS に転送して `docker compose up -d --build` を叩く」という Docker Compose 前提のフローだからです。

しかし vCluster サンプルは **`compose.yml` を持ちません**。理由は構造的です。

1. **k3s はシステムデーモン** です。`systemctl enable --now k3s` でノードに常駐するものであり、Docker コンテナとして compose で管理するものではありません（`k3s in docker` という手はありますが、余計な複雑さを持ち込みます）。
2. **vCluster CLI は k3s 上の Helm chart** として動きます。インストール先は稼働中の k8s クラスタであり、compose が管理するコンテナ起動とは概念が違います。
3. **検証コマンド（`kubectl`・`vcluster connect`）は VPS 上で対話的 or スクリプトで実行** するもので、ローカルからファイルを転送するモデルとは噛み合いません。

そのため、このサンプルは `conoha server create` で VPS を起動し、`conoha server ssh` 経由でスクリプトを流す構成にしています。

```
[ローカル PC]
    │
    │ 1. conoha server create  (00-provision.sh)
    ▼
[ConoHa VPS — ubuntu-26.04]
    │
    │ 2. conoha server ssh → k3s インストール  (01-setup-host.sh)
    ▼
[k3s クラスタ（シングルノード）]
    │
    │ 3. vcluster create tenant-a / tenant-b  (02-create-vclusters.sh)
    ▼
[仮想クラスタ × 2]
    │
    │ 4. 隔離 3 種を検証  (03-verify.sh)
    ▼
[ALL ISOLATION CHECKS PASSED]
```

---

## 構成図（ローカル → VPS → k3s → テナント）

```
ローカル PC
  └─ conoha CLI (v0.7.1)
       │  conoha server create / ssh
       ▼
ConoHa VPS (g2l-t-c4m4, ubuntu-26.04)
  └─ k3s v1.31.5+k3s1  (シングルノード: vm-0049e76f-e6)
       │
       ├─ namespace: team-a
       │    └─ vCluster v0.24.1 (tenant-a)  ← 独自 API サーバ
       │         ├─ CRD: crontabs.stable.example.com  (tenant-a 内にのみ存在)
       │         └─ Pod: demo  → host では demo-x-default-x-tenant-a として動作
       │
       └─ namespace: team-b
            └─ vCluster v0.24.1 (tenant-b)  ← 独自 API サーバ
                 └─ Pod: demo  → host では demo-x-default-x-tenant-b として動作
```

両テナントの Pod は **同じ host ノード**（`vm-0049e76f-e6`）に乗りますが、仮想クラスタからは完全に隔離されて見えます。

---

## 3 ステップで動かす

### Step 1 — `.env` を設定する

```bash
cd vcluster
cp .env.example .env
# KEY_NAME を自分の ConoHa キーペア名に書き換える
# 必要なら SERVER_NAME / FLAVOR も変更（デフォルト: g2l-t-c4m4）
```

### Step 2 — smoke-test.sh を実行する（e2e 一括）

```bash
bash scripts/smoke-test.sh
```

内部では以下の 4 フェーズを順番に SSH で実行します。

| フェーズ | スクリプト | 実行場所 |
|----------|-----------|---------|
| VPS 作成・SSH 到達待ち | `00-provision.sh` | ローカル |
| k3s + vcluster CLI 導入 | `01-setup-host.sh` | VPS |
| tenant-a / tenant-b 作成・CRD 投入 | `02-create-vclusters.sh` | VPS |
| 隔離 3 種を検証 | `03-verify.sh` | VPS |

最後に `SMOKE TEST PASSED` が出れば成功です。

### Step 3 — 撤去する

```bash
# 仮想クラスタ削除 + k3s アンインストール（VPS は残す）
bash scripts/teardown.sh

# VPS ごと破棄（ブートボリュームも削除）
bash scripts/teardown.sh --delete-server
```

---

## 隔離の実証 3 種（実際の出力を引用）

今回の実行は **実際の ConoHa VPS**（IP: 160.251.184.39、ノード名: `vm-0049e76f-e6`）上で行いました。以下はその実出力です。

### 1. CRD の隔離

`tenant-a` に `crontabs.stable.example.com` という CRD を入れ、`tenant-b` と host から見えないことを確認します。

```
=== [1/3] CRD isolation ===
  ok: CRD present in tenant-a
  ok: CRD absent in tenant-b
  ok: CRD absent on host
```

host 側でも確認済みです（`vcluster-host-view.log` より）。

```
=== host: CRDs containing crontab (should be empty) ===
(no crontab CRD on host — expected)
```

tenant-a に入れた CRD は tenant-b にも host にも **一切漏れていません**。

### 2. cluster-admin の隔離

tenant-a の中で cluster-admin 権限を持っていても、host の namespace `host-only-ns` や host の k3s システム Pod（`local-path-provisioner`）は見えません。

```
=== [2/3] cluster-admin isolation (tenant cannot see host resources) ===
  ok: tenant-a cannot see host namespace host-only-ns
  ok: tenant-a's kube-system is virtual (no host k3s system pods)
```

これが vCluster の最大の特徴です。テナントに cluster-admin を渡しても、テナントは「自分の仮想クラスタの中」しか見えないため、他テナントや host のリソースへのアクセスを完全に防げます。

### 3. host ノードの共有（syncer 経由）

仮想クラスタ内の Pod は **vCluster syncer** によって host 上の実 Pod として動きます。tenant-a と tenant-b の demo Pod が **同一ノード** にスケジュールされていることを実出力で確認できます。

```
=== [3/3] host node sharing (both tenants' pods land on the same host node) ===
  tenant-a demo pod scheduled on host node: vm-0049e76f-e6
  tenant-b demo pod scheduled on host node: vm-0049e76f-e6
  ok: both tenants' pods run on the same host node (vm-0049e76f-e6)
```

host 側で `kubectl get pods -n team-a -o wide` を実行すると、syncer がリネームした Pod 名も確認できます。

```
NAME                                               READY   STATUS    RESTARTS   AGE     IP           NODE
coredns-bbb5b66cc-wdndz-x-kube-system-x-tenant-a   1/1     Running   0          92s     10.42.0.13   vm-0049e76f-e6
demo-x-default-x-tenant-a                          1/1     Running   0          73s     10.42.0.14   vm-0049e76f-e6
tenant-a-0                                         1/1     Running   0          2m21s   10.42.0.8    vm-0049e76f-e6
```

`demo-x-default-x-tenant-a` というネーミングが syncer の命名規則（`<pod名>-x-<namespace>-x-<vcluster名>`）を示しています。tenant-b 側も同様で、同じ `vm-0049e76f-e6` ノード上に並んでいます。

### 最終結果

```
ALL ISOLATION CHECKS PASSED

SMOKE TEST PASSED
```

---

## 実際にハマった ConoHa CLI 差異 6 つ

サンプルスクリプトを `conoha` CLI v0.7.1 に合わせる過程で、仕様ドキュメントと食い違う点が 6 つありました。同じような実装をする方の参考になれば。

### 1. `--key` ではなく `--key-name`

```bash
# NG（ドキュメント例に多いが v0.7.1 では動かない）
conoha server create ... --key my-key

# OK
conoha server create ... --key-name my-key
```

自動化スクリプトでは `--no-input --yes` も必要です（確認プロンプトをスキップ）。

### 2. フレーバー名 `g2l-t-4` は存在しない

```bash
# NG
FLAVOR=g2l-t-4

# OK（実際に存在するフレーバー名）
FLAVOR=g2l-t-c4m4
```

`conoha flavor list` で確認すると、vCPU と RAM を明示した `c4m4` のような命名規則になっています。

### 3. プレーンな `ubuntu-24.04` がカタログに無い場合がある

`conoha image list` で確認し、`.env` の `IMAGE` に利用可能なイメージ名または ID を設定してください。今回の検証では `ubuntu-24.04` ベースイメージがカタログに存在しなかったため、`ubuntu-26.04` を使用しました。サンプルの既定値（`.env.example`）は `IMAGE=ubuntu-24.04` のままですが、環境によって差し替えが必要です。

```bash
# カタログにあるイメージ名を確認する
conoha image list

# .env に利用可能なイメージ名／ID を設定する（例: 今回の検証環境）
IMAGE=ubuntu-26.04
```

### 4. `--security-group` が必須

セキュリティグループを省略するとデフォルトが何もアタッチされず、SSH に繋がりません。

スクリプトでは `SECURITY_GROUPS` をスペース区切りで列挙し、それを `--security-group` フラグに展開しています。

```bash
# .env での設定例
SECURITY_GROUPS="default IPv4v6-SSH"

# スクリプト内での展開イメージ（スペース区切りをフラグに変換）
conoha server create ... --security-group default --security-group IPv4v6-SSH
```

`"default IPv4v6-SSH"` という名前の単一グループではなく、`default` と `IPv4v6-SSH` の **2 つのグループ** をそれぞれ指定しています。SSH を許可したセキュリティグループ名を明示的に渡す必要があります。

### 5. `--insecure` は SSH ホストキーチェックを無効にしない

`conoha server ssh` の `--insecure` フラグは TLS 証明書検証をスキップするものであり、SSH の host key checking とは別の話です。新規 VPS に非対話で SSH するには、事前に `ssh-keyscan` でホストキーを `~/.ssh/known_hosts` に登録する必要があります。

```bash
# 00-provision.sh 内でのプレシード例
ssh-keyscan -H "$SERVER_IP" >> ~/.ssh/known_hosts
```

### 6. `--format json` の `addresses` はネットワーク名をキーにした dict

```bash
conoha server show vcluster-host --format json
```

このとき返ってくる `addresses` フィールドは `{"Ext-Net": [{"version": 4, "addr": "160.251.x.x"}, {"version": 6, ...}]}` のような構造です。フラットな配列ではないため、IPv4 アドレスを取り出すには `version == 4` のエントリを辿るパースが必要です。

```bash
# Python での例
SERVER_IP=$(conoha server show "$SERVER_NAME" --format json \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
addrs=[a for v in d['addresses'].values() for a in v if a['version']==4]
print(addrs[0]['addr'])
")
```

---

## 類似 OSS との位置づけ

Kubernetes マルチテナンシーのアプローチは大きく 3 系統あります。

| アプローチ | 代表 OSS | 特徴 |
|------------|---------|------|
| **namespace 隔離** | [Capsule](https://capsule.clastix.io/)（Clastix） | Policy エンジン型。CRD や ClusterRole はホストと共有 |
| **ホスト型コントロールプレーン** | [Kamaji](https://kamaji.clastix.io/)（Clastix）/ [k0smotron](https://k0smotron.io/)（Mirantis） | API サーバーだけ隔離したい場合に最適。Kamaji は etcd を共有可 |
| **namespace 内の仮想 CP** | **vCluster**（loft-sh） | CRD + cluster-admin を完全隔離。ノードはホスト共有でコストを抑える |

vCluster は「テナントに cluster-admin と独自 CRD を安全に渡したいが、ノードを専有させるほどのコストはかけたくない」という用途にはまります。外部ネットワーク公開なしに VPS 1 台で完結できるため、開発・検証環境の素早いプロビジョニングにも向いています。

---

## まとめ

| 項目 | 内容 |
|------|------|
| **対象** | Kubernetes マルチテナンシーを検証したい開発者・SRE |
| **主なコマンド** | `conoha server create` / `conoha server ssh` |
| **推奨フレーバー** | `g2l-t-c4m4`（4 vCPU / 4GB）/ 最小 `g2l-t-c3m2` |
| **k3s バージョン** | v1.31.5+k3s1 |
| **vCluster バージョン** | v0.24.1 |
| **検証済みイメージ** | ubuntu-26.04 |
| **サンプルリンク** | https://github.com/crowdy/conoha-cli-app-samples/tree/main/vcluster |

vCluster は「Kubernetes を作るための Kubernetes」とも言え、1 台の VPS 上で本物の隔離された k8s 体験ができます。conoha-cli と組み合わせれば、`bash scripts/smoke-test.sh` の 1 コマンドでゼロからマルチテナント環境が立ち上がる様子をすぐに確かめられます。ぜひ試してみてください。
