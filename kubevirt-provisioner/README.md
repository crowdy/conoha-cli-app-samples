# kubevirt-provisioner

1 台の ConoHa VPS の中だけで **k3s（単一特権コンテナ）+ [KubeVirt](https://kubevirt.io/) + FastAPI provisioner** を Docker Compose で動かし、ブラウザから Ubuntu の仮想マシンを **作成 / 起動 / 停止 / 削除**し、**シリアルコンソール**を Web ターミナル（xterm.js）で操作できるサンプル。FastAPI が Kubernetes / KubeVirt API を叩いて VM をプロビジョニングします。

> **ハードウェア KVM で動きます。** ConoHa VPS3 は `/dev/kvm` を露出するため（実機検証済み、`SPIKE_NOTES.md` 参照）、KubeVirt はソフトウェアエミュレーションではなく**ハードウェア仮想化**でゲストを動かします。ゲスト起動は実測で初回 ~80 秒（イメージ pull 込み）/ 再起動 ~15 秒。

## アーキテクチャ

```
  ブラウザ ──HTTPS(conoha-proxy:443)──▶ api (FastAPI :8080, web)
                                          │  REST: VM 作成/一覧/起動/停止/削除
                                          │  WS  : /api/vms/{name}/console (xterm.js)
                                          │  kubeconfig(共有ボリューム, server→https://k3s:6443, クライアント証明書)
                                          ▼
                          k3s (単一特権コンテナ = クラスタ全体)
                            ├ KubeVirt control plane (virt-operator/api/controller/handler)
                            └ vms ns: VirtualMachine ─▶ VMI ─▶ virt-launcher pod (QEMU + /dev/kvm)
                                          ▲
                  kubevirt-bootstrap (one-shot): KubeVirt を apply して終了
```

| サービス | 役割 | 種別 |
|----------|------|------|
| `api` | FastAPI provisioner + Web UI + コンソールブリッジ | `web` (blue_green:false) |
| `k3s` | クラスタ全体（KubeVirt と VM がここで動く） | accessory（特権） |
| `kubevirt-bootstrap` | KubeVirt を 1 回 apply して終了 | accessory（one-shot） |

## デプロイ

```bash
conoha server create --name kubevirt --flavor g2l-t-c6m8 --image ubuntu-24.04 --key mykey
# conoha.yml の hosts: を自分の FQDN に（DNS A レコードが VPS を指していること）
conoha proxy boot --acme-email you@example.com kubevirt
conoha app init kubevirt
conoha app deploy kubevirt
# 初回は数分（k3s + KubeVirt のイメージ pull）。完了後 https://<FQDN> を開く。
```

推奨フレーバー **`g2l-t-c6m8`（6 vCPU / 8GB）**。KVM 加速なのでゲストは高速。8GB で 1〜2 VM が快適。

## 使い方

1. 上部バナーが KubeVirt の状態（初期化中 → ready）を表示。
2. 「Create VM」→ 行が増え、status が Starting → Running に。
3. 「Console」→ ブラウザにシリアルコンソール（ログイン: `ubuntu` / 入力したパスワード）。
4. ゲストはエフェメラル containerDisk。停止・再起動で初期化されます。

## 設定（`.env`）

| 変数 | 既定 | 意味 |
|------|------|------|
| `MAX_RUNNING_VMS` | 1 | 同時起動 VM 数の上限（RAM 保護） |
| `GUEST_MEMORY` | 2Gi | ゲスト 1 台あたりメモリ |
| `GUEST_CPU` | 1 | ゲスト vCPU 数 |
| `GUEST_IMAGE` | quay.io/containerdisks/ubuntu:24.04 | ゲスト containerDisk |

## `/dev/kvm` が無い環境の場合

`compose.yml` の `k3s` サービスから `devices: ["/dev/kvm:/dev/kvm"]` を外し、`manifests/kubevirt-cr.yaml` の代わりに `manifests/kubevirt-cr-emulation.yaml`（`useEmulation: true`）を使うと、ソフトウェアエミュレーションで動きます（10〜100 倍遅い）。ConoHa VPS3 では不要です。

## 仕組みのポイント

- **k3s コンテナの entrypoint** で k3s 起動前に `mount --make-rshared / /run /var/run` を実行します。virt-handler が `/var/run/kubevirt` を共有マウントとして要求するためで、これが無いと virt-handler が `CreateContainerError` になり KubeVirt が起動しません（`SPIKE_NOTES.md` 参照）。
- `api` は `/health` をプロセス起動と同時に 200 で返し（クラスタ待ちしない）、conoha-proxy のプローブを通します。KubeVirt の準備状況は `/api/status`、機能エンドポイントは未準備なら 503 を返します。
- コンソールは KubeVirt の serial-console subresource WebSocket（subprotocol `plain.kubevirt.io`）を、k3s admin のクライアント証明書認証でブリッジします。

## Out of Scope

本番運用 / マルチノード / 永続ディスク（CDI・DataVolume）/ ライブマイグレーション / GPU パススルー / 外部からのゲスト直 SSH（コンソールは Web 経由のみ）/ マルチテナント認可。
