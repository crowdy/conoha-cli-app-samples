# KubeVirt Provisioner サンプル — 設計

- **日付:** 2026-06-08
- **対象サンプル:** `kubevirt-provisioner/`
- **想定フレーバー:** `g2l-t-8` (8GB) 推奨 / `g2l-t-4` (4GB) は Ubuntu ゲストには逼迫（リスク最小値）
- **ステータス:** Design (実装前)

## 1. 背景と目的

`conoha-cli-app-samples` には Kubernetes 上で VM を扱う [KubeVirt](https://kubevirt.io/) 系のサンプルがない。KubeVirt は「Kubernetes API で仮想マシンを宣言的に管理する」CNCF プロジェクトで、コンテナと VM を同じ宣言モデルで扱える点が特徴。「1 台の ConoHa VPS の中だけで KubeVirt を体験し、Python (FastAPI) から API 経由で VM をプロビジョニングする」サンプルがあると、`slurm-rest-api` / `dns-server` に続く「API でインフラを操作する」系サンプルの入口になる。

このサンプルの目的：

1. 1 台の ConoHa VPS3 の中に、**k3s（単一特権コンテナ）+ KubeVirt（ソフトウェアエミュレーション）+ FastAPI provisioner** を Docker Compose だけで立ち上げる。
2. FastAPI から Kubernetes/KubeVirt API 経由で Ubuntu ゲスト VM を **作成 / 一覧 / 起動 / 停止 / 削除** できる（フルライフサイクル）。
3. 生成した VM の **シリアルコンソール**を、ブラウザの Web ターミナル（xterm.js）から触れる。FastAPI が KubeVirt のコンソール WebSocket をブリッジする。
4. cloud-init でログインユーザー・マーカーを注入し、「VM が起きて cloud-init が走った」ことを確認できる。

**非目標 (Out of Scope):** 本番運用、マルチノード、永続ディスク（CDI/DataVolume）、ライブマイグレーション、GPU パススルー、外部からのゲスト直 SSH、マルチテナント認可、ハードウェア仮想化前提の性能。詳細は §13。

### 1.1 前提となる事実（調査済み）

- KubeVirt は `/dev/kvm` が無い環境向けに **ソフトウェアエミュレーション**（`spec.configuration.developerConfiguration.useEmulation: true`）をサポートする。QEMU(TCG) で動くため **10〜100 倍遅い**が、デモ用途では十分。([software-emulation.md](https://github.com/kubevirt/kubevirt/blob/main/docs/software-emulation.md))
- ConoHa VPS3 の入れ子仮想化（`/dev/kvm` のゲスト露出）は公開ドキュメントで確証できない。多くのパブリック VPS は入れ子仮想化を無効化しているため、**エミュレーションを既定**とし、`/dev/kvm` があれば自動的に使う方針とする。
- これにより「k3s コンテナ上の KubeVirt をエミュレーションで動かす」構成は実現可能。kind/k3s 上で動かす事例も文書化されている。

## 2. アーキテクチャ概要

```
  ブラウザ
    | HTTPS (conoha-proxy :443)
    v
  +--------------------------------------------------------------+
  |  api  (web service, FastAPI :8080, blue_green:false)         |
  |   - REST: VM 作成/一覧/起動/停止/削除                          |
  |   - WS  : /api/vms/{name}/console  (xterm.js ブリッジ)        |
  |   - Web UI (静的 HTML/JS, ビルド不要)                          |
  +-----------------+--------------------------------------------+
                    | kubeconfig (共有ボリューム, server→https://k3s:6443)
                    | クライアント証明書認証
                    v
  +-----------------+--------------------------------------------+
  |  k3s  (accessory, 単一特権コンテナ, --privileged)             |
  |   server + agent + 内蔵 containerd                            |
  |   traefik/servicelb/metrics-server 無効化（スリム化）          |
  |   --tls-san k3s  /  --write-kubeconfig /output/...           |
  |                                                              |
  |   [KubeVirt control plane] virt-operator / virt-api /        |
  |                            virt-controller / virt-handler    |
  |                                                              |
  |   [vms namespace] VirtualMachine ─▶ VMI ─▶ virt-launcher pod |
  |                                            └ QEMU(TCG) emul. |
  |                                              = Ubuntu ゲスト  |
  +-----------------+--------------------------------------------+
                    ^
                    | 1 回だけ apply して終了
  +-----------------+--------------------------------------------+
  | kubevirt-bootstrap (accessory, one-shot)                     |
  |   k3s ready 待ち → KubeVirt operator + CR(useEmulation) apply |
  |   → kubevirt Available 待ち → exit 0 （冪等）                  |
  +--------------------------------------------------------------+
```

Compose サービスは 3 つ：

| サービス | 役割 | 種別 | 公開 |
|----------|------|------|------|
| `api` | FastAPI provisioner + Web UI + コンソールブリッジ | `web` (blue_green: false) | HTTPS (conoha-proxy) → :8080 |
| `k3s` | クラスター全体（server+agent+containerd）+ KubeVirt が載る | `accessory`（特権） | 内部のみ（kubeconfig 共有） |
| `kubevirt-bootstrap` | KubeVirt を 1 回 apply して終了する one-shot | `accessory` | なし |

**blue/green を web も含めて無効化する理由:** `k3s` は特権・ステートフル（クラスター状態 / 実行中 VM / containerd イメージ）な単一インスタンスで、スロットを 2 つ起動すると `k3s-data` ボリュームと :6443 を奪い合って壊れる。`dns-server` / `slurm-rest-api` と同じ stateful 単一インスタンスパターン。

## 3. ディレクトリレイアウト

```
kubevirt-provisioner/
├── README.md
├── compose.yml
├── conoha.yml
├── Dockerfile                      # FastAPI イメージ (python:3.12-slim)
├── .env.example                    # MAX_RUNNING_VMS, GUEST_MEMORY など
├── .dockerignore
├── pyproject.toml / requirements.txt
├── manifests/                      # ★ ピン留めした KubeVirt マニフェストを vendoring
│   ├── kubevirt-operator.yaml      # 例: v1.4.0
│   └── kubevirt-cr.yaml            # useEmulation:true を含む CR
├── bootstrap/
│   ├── Dockerfile                  # kubectl 入りの軽量イメージ (bitnami/kubectl ベース等)
│   └── entrypoint.sh               # ready 待ち → apply → wait Available
├── app/
│   ├── __init__.py
│   ├── main.py                     # FastAPI app / ルーティング / health
│   ├── k8s.py                      # kubeconfig ロード + server 書換 + クライアント生成
│   ├── vms.py                      # VirtualMachine CRUD (CustomObjectsApi)
│   ├── manifest.py                 # パラメータ → VirtualMachine dict ビルダー（純関数）
│   ├── console.py                  # KubeVirt console WS ↔ ブラウザ WS ブリッジ
│   └── static/
│       ├── index.html              # ミニ Web UI
│       ├── app.js                  # 一覧/作成/操作 + xterm.js コンソール
│       └── vendor/                 # xterm.js（CDN 不可環境向けに同梱可）
├── entrypoint.sh                   # kubeconfig server 書換 → uvicorn 起動
└── tests/
    ├── conftest.py
    ├── test_manifest.py            # ビルダー純関数の単体テスト
    ├── test_api.py                 # 入力検証・キャップ enforcement（k8s client mock）
    └── smoke_test.py               # 手動 e2e スモーク（slurm/opencascade スタイル）
```

KubeVirt のマニフェストは GitHub Release への実行時依存を避けるため、**ピン留め版をリポジトリに vendoring** する（オフライン/再現性のため。`slurm` が固定イメージを使うのと同じ思想）。

## 4. Compose サービス詳細

### 4.1 `k3s`（クラスター）

- イメージ: `rancher/k3s:<pinned>`（例 `v1.31.x-k3s1`）。
- `privileged: true`、`command: server` に以下のフラグ：
  - `--disable traefik --disable servicelb --disable metrics-server`（RAM 節約。Web 入口は FastAPI、外部公開は conoha-proxy が担うため traefik 不要）
  - `--tls-san k3s`（**重要**: api コンテナが kubeconfig の `server` を `https://k3s:6443` に書き換えて接続するため、サーバ証明書 SAN に `k3s` を含める必要がある。無いと TLS 検証に失敗する）
  - `--write-kubeconfig /output/kubeconfig.yaml --write-kubeconfig-mode 644`
- ボリューム:
  - `k3s-data:/var/lib/rancher/k3s`（クラスター状態・containerd イメージを永続化）
  - `kubeconfig:/output`（api と共有）
  - tmpfs `/run`, `/var/run`（k3d 同等の要件）
- cgroup v2 環境で動かすためのマウント/設定（`cgroupns: host` 等）は **§13 のスパイクで確定**する。
- `/dev/kvm`: 存在すれば `devices` で渡す（無い場合はエミュレーション）。VPS で保証されないため必須にはしない。compose ではコメントで案内、もしくは起動スクリプトで存在検出。
- healthcheck: `k3s kubectl get --raw=/readyz`（ノード Ready 判定）。

### 4.2 `kubevirt-bootstrap`（one-shot）

- `bootstrap/Dockerfile`: kubectl を含む軽量イメージ。
- `entrypoint.sh`:
  1. `kubeconfig` 共有ボリュームの出現と k3s API の `/readyz` を待つ（バックオフ）。
  2. `manifests/kubevirt-operator.yaml` を apply。
  3. `manifests/kubevirt-cr.yaml`（`useEmulation: true`）を apply。
  4. `kubectl -n kubevirt wait kubevirt/kubevirt --for=condition=Available --timeout=600s`。
  5. `vms` namespace を作成（無ければ）。
  6. exit 0。再実行しても安全（apply は冪等）。
- `restart: "no"`（完了したら起動しっぱなしにしない）。

### 4.3 `api`（FastAPI = web サービス）

- `Dockerfile`: `python:3.12-slim`、`fastapi` / `uvicorn` / `kubernetes` / `aiohttp`（コンソール WS 用）。
- `entrypoint.sh`: 共有ボリュームの `kubeconfig.yaml` をコピーし、`server: https://127.0.0.1:6443` を `https://k3s:6443` に書き換え（CA・クライアント証明書はそのまま）→ `uvicorn app.main:app --host 0.0.0.0 --port 8080`。
- 認証は k3s admin kubeconfig のクライアント証明書を使用（デモ簡略化）。コンソール WS 用には CA + クライアント証明書から SSL コンテキストを組み立てる。
- env: `MAX_RUNNING_VMS`（既定 1、8GB+エミュレーションでの安全値。最大 2 程度）、`GUEST_MEMORY`（既定 `2Gi`）、`GUEST_CPU`（既定 1）、`VM_NAMESPACE`（既定 `vms`）、`GUEST_IMAGE`（既定 `quay.io/containerdisks/ubuntu:24.04`）。

## 5. FastAPI 表面

| メソッド | パス | 役割 |
|----------|------|------|
| GET | `/health` | **クラスター API に到達できれば 200**（KubeVirt 完全起動前でも proxy probe を通す）。 |
| GET | `/api/status` | KubeVirt の Available 状態・バージョン・エミュレーション有無を返す（UI が「初期化中」を表示する用）。 |
| GET | `/` | ミニ Web UI（静的 HTML/JS）。 |
| GET | `/api/vms` | VM 一覧（name / phase / ready / ゲスト IP）。 |
| POST | `/api/vms` | VM 作成。body: `{name, memory?, cpu?, sshKey?/password?}`。Ubuntu containerDisk + cloudInitNoCloud + masquerade で `VirtualMachine`(running:true) を作成。**キャップ超過時 409**。 |
| GET | `/api/vms/{name}` | 1 件詳細。 |
| POST | `/api/vms/{name}/start` | `spec.running=true`（または start サブリソース）。 |
| POST | `/api/vms/{name}/stop` | `spec.running=false`。 |
| DELETE | `/api/vms/{name}` | VM 削除。 |
| WS | `/api/vms/{name}/console` | KubeVirt シリアルコンソール WS をブラウザ WS へブリッジ。 |

- VM 名は `[a-z0-9-]{1,40}` で検証（k8s 名前規則）。
- `/health` は KubeVirt 準備を要求しない（KubeVirt 起動は数分かかるため、proxy のタイムアウトを避ける）。機能エンドポイントは KubeVirt 未準備なら **503 + 明確なメッセージ**。

## 6. VM テンプレート（manifest.py）

純関数 `build_vm(name, memory, cpu, cloud_init) -> dict` が `kubevirt.io/v1 VirtualMachine` を生成：

- `spec.template.spec.domain.devices.disks`: containerDisk（Ubuntu cloud イメージ）+ cloudInitNoCloud ディスク。
- `spec.template.spec.domain.resources.requests.memory`: `GUEST_MEMORY`（既定 2Gi）。
- `spec.template.spec.domain.cpu.cores`: `GUEST_CPU`。
- network: `masquerade` + default pod network（ポッドネットワーク IP を取得。外部直アクセスはしない）。
- `volumes`: containerDisk = `quay.io/containerdisks/ubuntu:24.04`、cloudInitNoCloud = userData（ユーザー作成・パスワード/SSH 公開鍵・確認用マーカー書込み）。
- ディスクは **エフェメラル containerDisk**（CDI/PVC 不要）。停止・再起動で初期化される（デモ前提、§13 で明示）。

## 7. Web UI / コンソール

- 単一ページ（`static/index.html` + `app.js`）。ビルドステップ無し（`dns-server` / `opencascade-fem` のフロント同様、素の HTML/JS）。
- 機能: VM 一覧テーブル（状態ポーリング）、作成フォーム、各行に start/stop/delete、選択 VM のコンソールを **xterm.js** で表示。
- コンソール: ブラウザが `wss://<host>/api/vms/{name}/console` に接続 → `console.py` が KubeVirt の `/apis/subresources.kubevirt.io/v1/namespaces/{ns}/virtualmachineinstances/{name}/console` WS（subprotocol あり）へ中継。生バイトを双方向に流す。VMI 未起動時は 409/クローズ理由を返す。

## 8. conoha.yml

```yaml
name: kubevirt-provisioner
# Replace with your own FQDN before running `conoha app init`.
hosts:
  - kubevirt.example.com
web:
  service: api
  port: 8080
  # k3s は特権・ステートフルな単一インスタンス。スロットを複製できないため固定。
  blue_green: false
health:
  path: /health
  # 60 × 5s = 300s。k3s 起動 + KubeVirt operator のイメージ pull を吸収。
  # /health はクラスター到達のみ要求するので KubeVirt 完全起動は待たない。
  unhealthy_threshold: 60
accessories:
  - k3s
  - kubevirt-bootstrap
```

## 9. サイジング

| 項目 | 概算 RAM |
|------|---------|
| k3s（スリム化） | ~1.0 GB |
| KubeVirt control plane（operator/api/controller/handler） | ~1.0 GB |
| FastAPI | ~0.15 GB |
| Ubuntu ゲスト 1 台（エミュレーション） | ~2.0 GB |
| イメージ pull/展開 + ページキャッシュ + OOM 回避マージン | ~2.0 GB |
| **合計目安** | **~6 GB → 8GB 推奨** |

- **推奨 `g2l-t-8` (8GB)**。`g2l-t-4` は Ubuntu エミュレーションには逼迫（リスク最小値としてのみ記載）。
- エミュレーションは CPU バウンド → vCPU が多いほどゲスト起動が速い。
- 同時起動 VM は `MAX_RUNNING_VMS`（既定 1）でキャップし RAM 圧迫を防ぐ。

## 10. エラー処理

- k3s 未到達: `/health` は到達できるまで非 200（proxy が待つ）。到達後は 200。
- KubeVirt 未準備: 機能エンドポイントは 503 + メッセージ。UI は `/api/status` を見て「初期化中」を表示。
- VM 数キャップ超過: 409。
- コンソール WS で VMI 未起動: 409 もしくは即時クローズ（理由付き）。
- kubeconfig server 書換失敗 / TLS SAN 不一致: api が起動時にリトライ（k3s の `--tls-san k3s` で SAN を担保）。
- bootstrap の apply 失敗: バックオフ再試行。

## 11. テスト（リポジトリパターン）

- `tests/test_manifest.py`: `build_vm()` 純関数の単体テスト（パラメータ → 期待する VirtualMachine dict）。
- `tests/test_api.py`: 名前検証・キャップ enforcement・エラーパスを **k8s client を mock** して検証。
- `tests/smoke_test.py`: 実 VPS 上の手動 e2e スモーク（k3s 起動 → KubeVirt Available → VM 作成 → Running → コンソール応答 → 削除）。`slurm-rest-api` / `opencascade-fem` のスモークと同様、CI では mock ベース軽量テストに留め、フル KubeVirt e2e は README に手順を記載。

## 12. デプロイ手順（README に記載予定）

```bash
conoha server create --name kubevirt --flavor g2l-t-8 --image ubuntu-24.04 --key mykey
# conoha.yml の hosts を自分の FQDN に
conoha proxy boot --acme-email you@example.com kubevirt
conoha app init kubevirt
conoha app deploy kubevirt
# 数分（k3s + KubeVirt の起動 + イメージ pull）後、https://<FQDN> へ
```

## 13. リスクと検証スパイク（実装計画の 1 番目）

最大の不確実性は「**コンテナ化された単一ノード k3s 上で KubeVirt がエミュレーションで正しく起動するか**」。実装の前に、実 VPS 上で次を検証するスパイクを置く：

1. `rancher/k3s` を `--privileged` + 必要な cgroup/tmpfs マウントで起動し、ノードが Ready になる（k3s コンテナの正確なフラグ群を確定）。
2. KubeVirt operator + CR（`useEmulation:true`）を apply し、`kubevirt` が Available になる（virt-handler が単一ノードで動くか、必要な featureGate の有無を確定）。
3. Ubuntu containerDisk の VMI を作成し、`Running` に到達 → シリアルコンソールが応答する。
4. api コンテナから `https://k3s:6443`（`--tls-san k3s`）で接続でき、コンソール WS をブリッジできる。
5. エミュレーションでの Ubuntu 起動所要時間を計測し、UI/タイムアウトの目安を決める。

スパイクで判明した k3s フラグ・KubeVirt 設定・タイムアウトをこの設計に反映してから本実装に入る。

その他のリスク: kubeconfig server 書換 + TLS SAN（→ `--tls-san k3s`）／エミュレーション起動の遅さ（→ 余裕あるタイムアウト + 「booting」表示）／RAM 圧迫（→ 同時 VM キャップ）。

## 14. Out of Scope

本番運用 / マルチノード / 永続ディスク（CDI・DataVolume）/ ライブマイグレーション / GPU パススルー / 外部からのゲスト直 SSH（コンソールは Web 経由のみ）/ マルチテナント認可 / ハードウェア仮想化前提の性能。これらは将来の拡張余地として README に明記する。
