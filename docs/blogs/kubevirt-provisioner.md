---
title: conoha-cli で KubeVirt を VPS 1 台に丸ごと — ブラウザから VM をプロビジョニング、しかもハードウェア KVM で動く
tags: ConoHa conoha-cli KubeVirt Kubernetes k3s
author: crowdy
slide: false
---

## はじめに

[KubeVirt](https://kubevirt.io/) は「**Kubernetes の流儀で仮想マシンを宣言的に扱う**」CNCF プロジェクトです。`VirtualMachine` という CRD を `kubectl apply` すれば VM が立ち上がり、Pod と同じ土俵でスケジューリング・ライフサイクル管理ができます。面白いんですが、普段は「ベアメタルの k8s クラスタが要る」「ネスト仮想化できる環境が要る」とハードルが高めで、ちょっと触ってみるには腰が重いのが正直なところでした。

そこで今回は、**ConoHa VPS3 を 1 台だけ**使って、

- **k3s を単一の特権コンテナ**で起動して「クラスタ全体」を 1 コンテナに畳み込み、
- その中に **KubeVirt** を入れ、
- **FastAPI のプロビジョナ**（Web UI + REST + シリアルコンソールブリッジ）から **ブラウザだけで Ubuntu VM を作成・起動・停止・削除**できる、

というサンプルを `conoha-cli` で一発デプロイできるようにしてみました。全部 **Docker Compose で 1 台の VPS の中**に収まります。

そして検証中に一番うれしかった発見がこれです:

> **ConoHa VPS3 は `/dev/kvm` を露出している。** つまり KubeVirt のゲストは**ソフトウェアエミュレーションではなく、ハードウェア KVM 加速**で動く。当初は「VPS の上だからネスト無理 → `useEmulation: true` で 10〜100 倍遅い」と覚悟していたのが、見事に覆りました。

サンプル一式: [crowdy/conoha-cli-app-samples — kubevirt-provisioner](https://github.com/crowdy/conoha-cli-app-samples/tree/main/kubevirt-provisioner)
PR: [#109 feat(kubevirt-provisioner)](https://github.com/crowdy/conoha-cli-app-samples/pull/109)

![screenshot](https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/main/kubevirt-provisioner/docs/screenshot.png)

上のスクリーンショットが実際に動いている様子です。`KubeVirt ready (phase: Deployed)` のバナー、Running 状態の VM、そして下部の **xterm.js のシリアルコンソールでゲスト Ubuntu に入って `free -h` / `df -h` を叩いている**ところまで、すべてブラウザの中で完結しています。`/dev/vda1` がちゃんと見えていて、これは紛れもなく本物の VM です。

主な構成:

- **クラスタ**: k3s `v1.31.5-k3s1`（単一特権コンテナ。traefik / servicelb / metrics-server は無効化）
- **仮想化**: KubeVirt `v1.4.0`（virt-operator / api / controller / handler）+ ハードウェア KVM（`/dev/kvm`）
- **ゲスト**: `quay.io/containerdisks/ubuntu:24.04`（エフェメラルな containerDisk + cloud-init）
- **プロビジョナ**: FastAPI + uvicorn（REST CRUD、`/api/vms/{name}/console` の WebSocket コンソールブリッジ）
- **フロント**: バニラ JS + xterm.js（ベンダリング、ビルド不要）
- **オーケストレーション**: Docker Compose（`conoha-cli` の `web` = api、`accessories` = k3s / bootstrap）

実測タイミング（`g2l-t-c6m8`、ハードウェア KVM）:

| 操作 | 時間 |
|---|---|
| k3s ノードが Ready | ~1 分 |
| KubeVirt が `Available`（初回のイメージ pull 込み） | 2〜4 分 |
| VM 作成 → Running（初回、containerDisk pull 込み） | **~80 秒** |
| VM 再起動（stop→start） | **~15 秒** |

---

## 想定読者

- KubeVirt / Kubernetes-native な VM 管理を**手を動かして触ってみたい**方
- 「VPS の中で KVM ネスト仮想化って実際どうなの？」が気になる方
- k3s を「クラスタ丸ごと 1 コンテナ」で動かす構成に興味がある方
- `conoha-cli` で**ちょっと変わったスタックをサクッと立てたい**方

---

## アーキテクチャ

ポイントは「**入れ子になった仮想化レイヤー**」です。VPS の中に Docker、その中に k3s（=クラスタ全体）、その中に KubeVirt が起動する virt-launcher Pod、さらにその中で QEMU が `/dev/kvm` を使ってゲストを回す、という構造になっています。

```
  ブラウザ ──(A) SSH トンネル localhost:8080 / (B) HTTPS conoha-proxy:443──▶
                                          │
                                          ▼
  ┌──────────────────────── ConoHa VPS3 (1 台) ─────────────────────────┐
  │  Docker Compose                                                      │
  │                                                                      │
  │   api (FastAPI :8080, conoha "web")                                  │
  │     ├ REST : POST/GET/DELETE /api/vms, start/stop                    │
  │     ├ WS   : /api/vms/{name}/console  (xterm.js)                     │
  │     └ kubeconfig(共有ボリューム, server→https://k3s:6443, client cert)│
  │                          │                                           │
  │                          ▼                                           │
  │   k3s (単一特権コンテナ = クラスタ全体)                              │
  │     ├ KubeVirt control plane (virt-operator/api/controller/handler)  │
  │     └ vms ns: VirtualMachine ─▶ VMI ─▶ virt-launcher Pod             │
  │                                          └ QEMU + /dev/kvm (HW 加速)  │
  │                          ▲                                           │
  │   kubevirt-bootstrap (one-shot): KubeVirt を apply して終了           │
  └──────────────────────────────────────────────────────────────────────┘
```

| サービス | 役割 | conoha 種別 |
|----------|------|-------------|
| `api` | FastAPI プロビジョナ + Web UI + コンソールブリッジ | `web`（`blue_green: false`） |
| `k3s` | クラスタ全体（KubeVirt と VM がここで動く） | accessory（特権・ステートフル） |
| `kubevirt-bootstrap` | KubeVirt を 1 回だけ apply して終了 | accessory（one-shot・冪等） |

`api` は kubeconfig（k3s が共有ボリュームに書き出したもの）で Kubernetes / KubeVirt API を叩き、`VirtualMachine` の作成・`spec.running` の true/false トグル・削除を行います。シリアルコンソールは KubeVirt の subresource WebSocket をブラウザの xterm.js へ中継します。

> k3s は「特権・ステートフルな単一インスタンス」なので、`blue_green: false`（青/緑スロットで複製できない）にしています。クラスタ状態と containerd のイメージは名前付きボリュームに永続化されます。

---

## Quick start

`conoha-cli` 設定済み・SSH キー登録済みが前提です。**Docker / Compose がプリインストールされたイメージ**を選び、`/dev/kvm` を持つ **ConoHa VPS3** で動かします。

```bash
# 1. VPS を作成（Docker 入りイメージ + 6 vCPU / 8GB）
conoha server create \
  --name kubevirt-provisioner \
  --flavor g2l-t-c6m8 \
  --image vmi-docker-29.2-ubuntu-24.04-amd64 \
  --key-name your-key \
  --security-group default \
  --security-group IPv4v6-SSH \
  --security-group IPv4v6-Web \
  --no-input --yes --wait

# 2. DNS A レコードを VPS の IP に向ける（Cloudflare 等）
#    例: kubevirt.example.com → <IP>

# 3. proxy 起動（初回のみ）
conoha proxy boot --acme-email you@example.com kubevirt-provisioner --no-input --yes

# 4. conoha.yml の hosts を自分のドメインに書き換える
#    cd kubevirt-provisioner
#    sed -i 's|kubevirt.example.com|kubevirt.crowdy.dev|' conoha.yml

# 5. デプロイ
conoha app init   kubevirt-provisioner --no-input --yes
conoha app deploy kubevirt-provisioner --no-input --yes
```

初回デプロイは数分かかります（k3s と KubeVirt operator のイメージ pull が重い）。`conoha.yml` の health は `unhealthy_threshold: 120`（120 × 5s = 600s）と寛容にしてあり、コールドスタートの長い初回起動を吸収します。

### ドメイン無しで今すぐ試す（SSH トンネル）

公開 HTTPS は conoha-proxy + 実 FQDN が要りますが、「とりあえず触る」なら **SSH ローカルフォワードで `localhost:8080` に繋ぐ**のが手軽です（冒頭のスクリーンショットもこの経路です）。`api` の 8080 はコンテナ内 `expose` なので、コンテナ IP へトンネルします:

```bash
# VPS 側で api コンテナ IP を確認
API_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' kubevirt-provisioner-api-1)

# 手元から SSH トンネル（このセッションを張ったままブラウザで http://localhost:8080）
ssh -i ~/.ssh/your-key -L 8080:$API_IP:8080 root@<VPS_IP>
```

---

## 使い方

1. 上部バナーが KubeVirt の状態（初期化中 → `KubeVirt ready`）を表示します。
2. **Create VM** に名前とパスワードを入れて作成 → 行が増え、status が `Starting → Running` に。
3. **Console** を押すとブラウザにシリアルコンソールが開きます。ログインは `ubuntu` /（作成時に入れたパスワード）。
4. ゲストは**エフェメラルな containerDisk** なので、停止・再起動で初期化されます。

> パスワードはどこにも保存・再表示されません（API の VM 一覧は name / status のみ返す）。作成時に入れた値で cloud-init の `ubuntu` ユーザに設定されます。忘れたら VM を作り直すのが早いです。

デフォルトでは `MAX_RUNNING_VMS=1`（RAM 保護）。`GUEST_MEMORY`（既定 2Gi）/ `GUEST_CPU`（既定 1）/ `GUEST_IMAGE` は `.env` で変えられます。

---

## ハマりどころ — k3s in a container で KubeVirt を動かすまでの罠

ここからが本題です。「k3s を 1 コンテナで」「その中で KubeVirt」「さらにブラウザコンソール」と積み上げると、各レイヤーの境界でいくつも罠を踏みました。実機（ConoHa VPS3）でのスパイク検証で潰した順に並べます。

| # | 罠 | 対処 |
|---|----|------|
| K1 | virt-handler が `CreateContainerError` でずっと上がらず、KubeVirt が `Available` にならない。エラーは *"path /var/run/kubevirt is mounted on /var/run but it is not a shared mount"* | k3s 起動**前**に `mount --make-rshared` で `/`・`/run`・`/var/run` を共有マウント化（entrypoint ラッパー） |
| K2 | そもそも VPS でネスト仮想化できるのか？ できないと `useEmulation: true` で激遅 | ConoHa VPS3 は `/dev/kvm` を露出。コンテナに渡すとノードが `devices.kubevirt.io/kvm` を広告 → **ハードウェア KVM**。`useEmulation` は未設定でよい |
| K3 | kubeconfig は `server: https://127.0.0.1:6443` で書かれる。別コンテナ（api / bootstrap）からは届かない | サーバ URL を `https://k3s:6443` に書き換え、k3s 側は `--tls-san=k3s` で証明書 SAN を通す |
| K4 | コンソール WS が virt-api 経由でハンドシェイクに失敗 | k3s admin の**クライアント証明書**で SSL context を構築（CA + cert + key）、subprotocol は `plain.kubevirt.io` |
| K5 | conoha-proxy の health probe が「クラスタ起動待ち」でタイムアウトし、active slot に昇格しない | `/health` はプロセス起動と同時に 200 を返す（クラスタ非依存）。準備状況は別途 `/api/status`。`depends_on` は `service_started` |

### K1: virt-handler は `/var/run` が「共有マウント」であることを要求する（最大の壁）

これが唯一にして最大のブロッカーでした。k3s 自体は普通に Ready になり、KubeVirt の operator も動くのに、**virt-handler（各ノードのエージェント）だけがいつまでも `CreateContainerError`** で、KubeVirt が `Available` に到達しません。ログを見ると:

```
path /var/run/kubevirt is mounted on /var/run but it is not a shared mount
```

virt-handler は `/var/run/kubevirt` を **Bidirectional**（双方向）のマウント伝播でバインドします。これには親である `/var/run` が **shared マウント**である必要があります。ところがコンテナ内の `/run`・`/var/run`（ここでは tmpfs）はデフォルトで shared になっていません。

対処は、**k3s を起動する前に**マウントを rshared 化することです。compose の `k3s` サービスを entrypoint ラッパーにして:

```yaml
k3s:
  image: rancher/k3s:v1.31.5-k3s1
  privileged: true
  entrypoint: ["/bin/sh", "-c"]
  command:
    - |
      mount --make-rshared /        2>/dev/null || true
      mount --make-rshared /run     2>/dev/null || true
      mount --make-rshared /var/run 2>/dev/null || true
      exec /bin/k3s server \
        --disable=traefik --disable=servicelb --disable=metrics-server \
        --tls-san=k3s \
        --write-kubeconfig=/output/kubeconfig.yaml --write-kubeconfig-mode=644
  tmpfs: [/run, /var/run]
  devices: ["/dev/kvm:/dev/kvm"]
  volumes:
    - k3s-data:/var/lib/rancher/k3s
    - kubeconfig:/output
    - /lib/modules:/lib/modules:ro
```

このラッパーを入れたら、virt-handler は **手作業ゼロで ~5 秒で Ready** になりました。cgroup v2 まわりの一般論かと最初は疑ったのですが、犯人はこの共有マウント 1 点だけでした。

### K2: ネスト仮想化は無理、と思っていたら `/dev/kvm` があった

設計段階の前提は「VPS の上だからハードウェア仮想化は使えない → KubeVirt の `useEmulation: true`（QEMU TCG）で、10〜100 倍遅いのを覚悟」でした。ところが実機を見ると:

```
$ ls -l /dev/kvm
crw-rw---- 1 root kvm 10, 232 ... /dev/kvm
```

`/dev/kvm` が存在します。これを k3s コンテナに `devices: ["/dev/kvm:/dev/kvm"]` で渡すと、ノードが `devices.kubevirt.io/kvm: 1k` を広告し、VMI に `devices.kubevirt.io/kvm: 1` が割り当たりました。つまり**ゲストはハードウェア KVM 加速で動いています**。KubeVirt CR も拍子抜けするほどシンプルで:

```yaml
apiVersion: kubevirt.io/v1
kind: KubeVirt
metadata: { name: kubevirt, namespace: kubevirt }
spec:
  configuration: {}   # /dev/kvm があるので useEmulation は未設定でよい
```

`/dev/kvm` が無いホスト向けには、`devices` 行を外して `useEmulation: true` の CR（`manifests/kubevirt-cr-emulation.yaml`）に差し替えるフォールバックも同梱してあります。ただし ConoHa VPS3 では不要でした。VM 起動も **初回 ~80 秒 / 再起動 ~15 秒**と、エミュレーションでは到底出ない速さです。

### K3: kubeconfig のサーバ URL を書き換える + `--tls-san`

k3s が書き出す kubeconfig のサーバは `https://127.0.0.1:6443` です。これは k3s コンテナ自身からは正しいですが、**api / bootstrap という別コンテナからは届きません**。compose ネットワークのサービス名 `k3s` で到達する必要があります。

そこで kubeconfig のサーバ URL を `https://k3s:6443` に書き換えます。当然このホスト名は k3s のデフォルト証明書 SAN に入っていないので、k3s 側に `--tls-san=k3s` を渡して証明書に SAN を追加しておきます。bootstrap コンテナでは:

```sh
cp "$KUBECONFIG_SRC" "$KUBECONFIG"
kubectl --kubeconfig="$KUBECONFIG" config set-cluster default --server=https://k3s:6443
```

api 側も同じ書き換えをしてからクライアントを生成します。

### K4: ブラウザコンソールは「admin クライアント証明書」で aggregated virt-api を抜ける

シリアルコンソールは KubeVirt の subresource WebSocket です:

```
wss://k3s:6443/apis/subresources.kubevirt.io/v1/namespaces/{ns}/virtualmachineinstances/{name}/console
```

これは aggregated API（virt-api）越しの呼び出しで、認証が要ります。k3s admin の **クライアント証明書**（kubeconfig の CA / client-cert / client-key を base64 デコードしてファイル化）で SSL context を組み、cluster-admin 権限で通します。subprotocol は **`plain.kubevirt.io`**:

```python
SUBPROTOCOL = "plain.kubevirt.io"

def build_ssl_context(ca_cert, client_cert, client_key):
    ctx = ssl.create_default_context(cafile=ca_cert)
    ctx.load_cert_chain(certfile=client_cert, keyfile=client_key)
    return ctx
```

api はこの上流 WS とブラウザの WS を双方向に `pump`（`asyncio.wait(..., FIRST_COMPLETED)`）でブリッジします。ブラウザ → api → cluster と中継するので、クラスタの API を外に晒さずに済みます。

### K5: `/health` は即 200、`/api/status` で本当の準備状況

conoha-proxy は health probe（`/health`）が通って初めて active slot に昇格させます。ところが KubeVirt のコールドスタートは数分かかるので、「クラスタが ready になるまで `/health` を 503 にする」設計だと **probe がタイムアウトしてデプロイが終わりません**。

そこで `/health` は **api プロセスが起動した瞬間に 200** を返す（クラスタの状態を見ない）ようにし、compose の `depends_on` も `service_healthy` ではなく `service_started` にしました。本当の準備状況は `/api/status`（`{"available": true, "phase": "Deployed"}`）で表現し、機能エンドポイントはクラスタ未準備なら 503 を返します。Web UI 上部のバナーはこの `/api/status` をポーリングして「初期化中 → ready」を出しています。

---

## 検証 — 実機で end-to-end を通した

`g2l-t-c6m8`（6 vCPU / 8GB、Ubuntu / Docker 29.5 + Compose）の実 VPS に、出荷する `compose.yml` をそのまま `docker compose up -d --build` してフルスタックを検証しました:

| 項目 | 結果 |
|------|------|
| bootstrap が KubeVirt を apply → `Available` | ✅ 手作業ゼロ |
| api `/health` / `/api/status` | ✅ 200 / `{"available":true,"phase":"Deployed"}` |
| `POST /api/vms` → VM が Running（ハードウェア KVM） | ✅ ~80 秒 |
| `spec.running` の true/false トグル（start/stop） | ✅ stop で VMI 消滅、start で ~15 秒復帰 |
| コンソール WS（ブラウザ → api → cluster, `plain.kubevirt.io`） | ✅ バイトが流れる（冒頭のスクショ） |
| ユニットテスト / ruff | ✅ 44 passed / clean |

冒頭のスクリーンショットは、この検証スタックに SSH トンネルで繋いで `tkim-test` という VM を作り、コンソールでログインして `free -h` / `df -h` を叩いたものです。`Mem: 1.9Gi`・`/dev/vda1 2.4G` と、ゲスト VM の中身がそのまま見えています。

---

## まとめ

最終的に手に入ったもの:

| 機能 | 状況 |
|------|------|
| ブラウザから VM の作成 / 起動 / 停止 / 削除 + シリアルコンソール | `conoha app deploy` 1 発 |
| k3s（単一特権コンテナ）+ KubeVirt + FastAPI を VPS 1 台に | Docker Compose |
| ハードウェア KVM 加速（ConoHa VPS3 の `/dev/kvm`） | VM 起動 ~80s 初回 / ~15s 再起動 |
| 実機 e2e 検証 | ✅ create→Running→console まで疎通 |

正直、一番の収穫は **「ConoHa VPS3 でハードウェア KVM が使える」**という発見でした。これのおかげで KubeVirt の体験が「遅いエミュレーションのおもちゃ」から「実用に耐える速さ」に変わります。そして `virt-handler` の共有マウント問題のように、**「k3s in a container」特有の罠は数こそ少ないが致命的**で、踏むと丸ごと動きません。本記事の K1〜K5 が、同じ構成に挑む方の地雷除去になればうれしいです。

KubeVirt を「とりあえず触ってみたい」とき、ベアメタルのクラスタを用意するのは大仕事ですが、**VPS 1 台 + `conoha-cli` で 1 コマンド**なら、壊しても作り直すだけ。学習・デモ・検証にはちょうどいい粒度だと思います。GitHub の issue / PR でフィードバックいただけるとうれしいです。

### 参考

- [crowdy/conoha-cli-app-samples — kubevirt-provisioner サンプル](https://github.com/crowdy/conoha-cli-app-samples/tree/main/kubevirt-provisioner)
- [PR #109 — feat(kubevirt-provisioner)](https://github.com/crowdy/conoha-cli-app-samples/pull/109)
- [KubeVirt — Kubernetes Virtualization API](https://kubevirt.io/)
- [KubeVirt user guide — Virtual machines](https://kubevirt.io/user-guide/)
- [k3s — Lightweight Kubernetes](https://k3s.io/)
- [containerdisks/ubuntu — KubeVirt 用 Ubuntu containerDisk](https://quay.io/repository/containerdisks/ubuntu)
- [xterm.js — ブラウザのターミナルコンポーネント](https://xtermjs.org/)
- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)
