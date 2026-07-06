---
title: conoha-cli で Slurm REST API に L4 GPU 計算ノードを追加 — 流体力学シミュレーション 4 種を `submit/fetch` する
tags: ConoHa conoha-cli Slurm GPU CFD
author: crowdy
slide: false
---

## はじめに

前回 [conoha-cli で Slurm の REST API + JWT 認証環境を ConoHa VPS3 に立てる](https://qiita.com/crowdy/items/4a6bc40c06205f4acf68) で、ConoHa VPS3 1 台に Slurm クラスター + `slurmrestd` を立てる `conoha-cli-app-samples` のサンプルを書きました。あれは CPU だけのワークロードで、`numpy` の行列積と `scikit-learn` の配列ジョブを流す構成でした。

今回はその続きで、**NVIDIA L4 GPU フレーバー** (`g2l-t-c20m128g1-l4`、24 GB VRAM) に **`gpu-worker` を追加して torch の本物のジョブをスケジューリングできる**ようにし、さらに **4 種類の流体力学（CFD）ワークロード** を例として同梱しました。仕上げに、ジョブの結果 PNG をローカルに引っ張ってくる `slurm_cli.py fetch` コマンドも足しています。

- L4 GPU 1 台で **`cpu` パーティションと `gpu` パーティション** が両方使える単一ノード Slurm クラスター
- `--gres gpu:1 --partition gpu` で **torch ジョブを GPU に投げる** REST API ワークフロー
- **CFD 4 種**: Sod 衝撃管 / リッド駆動キャビティ / LBM 円柱周りの流れ / Rayleigh-Bénard 熱対流
- 結果フィールドの PNG を **`slurm_cli.py fetch <JOB_ID>`** でローカル取得（slurmrestd はファイルを返さないので SSH サイドチャネル経由）

サンプル一式: [crowdy/conoha-cli-app-samples — slurm-rest-api](https://github.com/crowdy/conoha-cli-app-samples/tree/main/slurm-rest-api)

---

## 想定読者

- 前回の CPU 版を見て「GPU を足したらどうなるんだろう」と思った方
- Slurm の `--gres gpu:1` を REST API で**正しく**書く方法を知りたい方（後述のとおり罠があります）
- HPC スケジューラに本物の数値計算（CFD）を投げる小さなデモが欲しい方
- ジョブが書き出したフィールドの可視化 PNG を、ローカルに何の工夫もなく持ってくる方法を知りたい方

---

## 今回追加した 3 つの要素

| 要素 | 中身 |
|------|------|
| **`gpu-worker` アクセサリ** | NVIDIA Container Runtime で L4 を見せる Slurm worker。`Gres=gpu:nvidia:1` で自動登録 |
| **4 つの CFD ワークロード** | `examples/workloads/cfd_*.py` — 全部 self-contained な torch スクリプト |
| **`slurm_cli.py fetch`** | `conoha server ips` で IP 解決 → `ssh ... docker exec ... cat` で PNG をローカルへ |

構成図に落とすと、前回の図に `gpu-worker` が一つ生えただけです:

```
                       HTTPS (conoha-proxy + Let's Encrypt)
                                    │
                                    ▼
                          ┌──────────────────────┐
                          │ slurm-edge (caddy)   │  ← web slot
                          └──────────┬───────────┘
                                     │
                                     ▼
        ┌────────────────────────────────────────────────────┐   accessories
        │  slurmrestd ←── munge + JWT ──── slurmctld        │
        │                                       │           │
        │                                       ├── cpu-worker (Feature=cpu)
        │                                       └── gpu-worker (Feature=gpu, Gres=gpu:nvidia:1)
        │                                                    │
        │  slurmdbd ←─── munge ──────────────────────────────┘
        │      ↓ MySQL
        │  mariadb:12
        └────────────────────────────────────────────────────┘
```

ベースイメージは前回と同じ [`giovtorres/slurm-docker-cluster:25.11.4`](https://github.com/giovtorres/slurm-docker-cluster)。GPU 用には torch + matplotlib を足した薄いマルチステージレイヤーを上に被せています。

---

## Quick start（L4 で 1 コマンドデプロイ）

ConoHa VPS3 アカウント・`conoha-cli` 設定済み・SSH キー登録済み前提です。L4 は CPU フレーバーの数倍の時間課金なので、後でちゃんと破棄してください。

```bash
# 1. L4 VPS を作成
conoha server create \
  --name slurm-gpu \
  --flavor g2l-t-c20m128g1-l4 \
  --image vmi-docker-29.2-ubuntu-24.04-amd64 \
  --key-name your-key \
  --security-group default --wait
conoha server open-port slurm-gpu 22,80,443 -y

# 2. NVIDIA Container Toolkit + ドライバを入れる（~10 分、リブート 1 回）
conoha gpu setup slurm-gpu --identity ~/.ssh/your-key

# 3. プロキシ起動 & デプロイ
conoha proxy boot --acme-email you@example.com slurm-gpu
cd conoha-cli-app-samples/slurm-rest-api
cp .env.example .env
sed -i 's|slurm.example.com|<ip-with-dashes>.sslip.io|' conoha.yml
conoha app init   slurm-gpu --no-input
conoha app deploy slurm-gpu --no-input

# 4. JWT トークン取得
mkdir -p ~/.slurm-api
echo "https://<your-fqdn>" > ~/.slurm-api/endpoint
conoha server ssh slurm-gpu -- ./examples/get-token.sh slurm 86400 \
    > ~/.slurm-api/token
```

ここまで来たら `slurm_cli.py nodes` で 2 つのノードが見えるはずです:

```
$ ./slurm_cli.py nodes
c1               state=IDLE,DYNAMIC_NORM cpus=20 mem=128810MB
g1               state=IDLE,DYNAMIC_NORM cpus=20 mem=128810MB gres=gpu:nvidia:1
```

`g1` の `gres=gpu:nvidia:1` が見えていれば、L4 が gpu パーティションに正しく登録されています。

---

## 4 種類の CFD ワークロード

`examples/workloads/cfd_*.py` 配下に 4 本入っています。全部 self-contained で、torch のテンソル演算で書かれていて、**CUDA があれば自動で GPU 実行・無ければ CPU 実行**にフォールバックします（ローカル開発でも回せます）。

### 1. `cfd_sod_shock.py` — Sod 衝撃管（1D 圧縮性 Euler、HLL フラックス）

古典的な Riemann 問題。`t = 0.2` まで進めて密度・速度・圧力プロファイルを **厳密 Riemann 解と重ねて** PNG にします。観測量は数値解の衝撃波位置と厳密解の差。

```bash
./slurm_cli.py submit ../workloads/cfd_sod_shock.py \
    --partition gpu --gres gpu:1 --cpus 2 --mem 2048 --time 5 --inline
```

L4 で `~1 秒`、観測値 `x=0.851` vs 厳密解 `0.850` — グリッド分解能ぴったりまで一致します。

### 2. `cfd_lid_cavity.py` — リッド駆動キャビティ（非圧縮 Navier-Stokes）

上面が動く正方形キャビティの定常流。**渦度-流れ関数定式化** + Jacobi 反復の Poisson 解法（GPU で完全並列に走るように SOR は使わず）。観測量は **垂直中心線の最小 u 速度** で、Ghia et al. (1982) の Re=100 リファレンス `min u ≈ -0.21` と比較します。

```bash
./slurm_cli.py submit ../workloads/cfd_lid_cavity.py \
    --partition gpu --gres gpu:1 --cpus 2 --mem 4096 --time 8 --inline
```

L4 で `~60 秒`、観測値 `min u = -0.214` vs Ghia `-0.21` — 2 % 以内です。PNG は流れ関数の等高線（主渦 + コーナー渦）。

### 3. `cfd_lbm_cylinder.py` — 円柱周りの流れ（D2Q9 格子ボルツマン）

Jonas Latt 氏の有名な LBM チュートリアル例を torch に移植。`streaming = torch.roll`、`collision = elementwise` — どれも GPU 親和的です。後流に置いた速度プローブを FFT して **Strouhal 数** を推定します。

```bash
./slurm_cli.py submit ../workloads/cfd_lbm_cylinder.py \
    --partition gpu --gres gpu:1 --cpus 2 --mem 4096 --time 10 --inline
```

L4 で `520×180` 格子、`60,000` ステップが `~3 分`。PNG は渦度フィールドで、von Kármán の渦列がきれいに見えます。Strouhal の数値は後述の「正直な評価」で。

### 4. `cfd_rayleigh_benard.py` — Rayleigh-Bénard 熱対流（2D Boussinesq）

下面を加熱・上面を冷却した層に対流ロールが立つ問題。渦度-流れ関数 + 温度輸送方程式。観測量は **Nusselt 数** `Nu = 1 + <vT>`。

```bash
./slurm_cli.py submit ../workloads/cfd_rayleigh_benard.py \
    --partition gpu --gres gpu:1 --cpus 2 --mem 4096 --time 10 --inline
```

L4 で `~5 分`、`Ra = 10^5` での観測値 `Nu = 4.95`、文献は `3.9-4.3`。これも後述します。

---

## 結果 PNG をローカルに引っ張ってくる — `slurm_cli.py fetch`

`slurmrestd` には**ジョブ出力ファイルを返すエンドポイントがありません**。`/job/{id}` はジョブの状態だけ、stdout やワークロードが書いた PNG は取れない。なので結果回収には**サイドチャネル**が要ります。本サンプルでは「素直に SSH」を選びました:

```bash
$ ./slurm_cli.py fetch 5 --server slurm-gpu --identity ~/.ssh/your-key
fetched job 5 result -> slurm-5.png

$ file slurm-5.png
slurm-5.png: PNG image data, 1210 x 440, 8-bit/color RGBA, non-interlaced
```

内部で何をしているかというと:

1. `conoha server ips <server>` で IPv4 を解決
2. `ssh -i <key> root@<ip> 'docker exec $(docker ps -qf label=com.docker.compose.service=gpu-worker | head -1) cat /tmp/slurm-<id>.png'` を実行
3. stdout（生バイナリ）をローカルファイルにリダイレクト

ポイントが 2 つ:

- **`conoha server ssh` は使わず plain `ssh` を使う**。`conoha server ssh` は接続時に `Connecting to root@...` というバナーを stdout に出すので、バイナリ PNG ストリームが汚染されてしまいます。`conoha server ips` で IP だけ取って、あとは普通の `ssh` を呼ぶのが安全です。
- **コンテナの探索はラベルで**。`docker ps -qf label=com.docker.compose.service=gpu-worker` を使うと、compose プロジェクト名（`<app>-<slot>` vs `<app>-accessories` のように `conoha app deploy` で変わる）に依存しません。前作の `get-token.sh` で確立されたパターンと同じです。

CLI の純粋関数部分（`build_fetch_command`）には 5 つの単体テストを書いてあり、`shlex.quote` でリモートパスがちゃんとシェルエスケープされることまで保証しています。

---

## 実 L4 検証 — 正直な評価

`conoha app deploy` 経由で 4 ジョブを流した結果がこちらです。

| 観測量 | 観測値 | 文献値 | 評価 |
|--------|--------|--------|------|
| **Sod 衝撃波位置** `x` | `0.851` | `0.850` | ✅ 一致 |
| **キャビティ 中心線 min u** | `-0.214` | `-0.21` (Ghia, Re=100) | ✅ 一致 |
| **LBM Strouhal 数** | `0.250` | `0.16-0.18` (Re~100-200) | ⚠ 高め |
| **Rayleigh-Bénard Nu** | `4.95` | `3.9-4.3` (Ra=10^5) | ⚠ 高め |

2/4 がデフォルトでそのまま文献値を打ち、2/4 は外れました。**外れた 2 つは「ソルバーが壊れている」のではなく、「このデモサイズで文献値を打つには別の制約がぶつかる」というのが正しい解釈** です。コードと出力のほうもそう書きました:

### LBM の St が 0.25 になる理由

教科書の St ≈ 0.17 は「閉塞率の低い自由流」「omega が安定限界から十分遠い」前提で測られています。本デモは:

- **閉塞率 D/H = 40/180 = 0.22**（流路 ny に対する円柱直径の比）— 自由流より明らかに大きい
- **omega = 1/(3·nulb + 0.5) ≈ 1.94** — BGK の安定限界 2.0 のすぐ手前

この 2 つで実効 Re は名目 Re=150 より上がり、Strouhal も `0.20-0.30` の領域に入ります。プローブの位置を中心線から外しても、FFT を `[0.05, 0.30]` の帯域にフィルタしても、観測値は変わりません — つまりこれが**この設定での真の支配周波数**です。PNG を見れば渦列は教科書通りに発達しているので、「絵が定性的に正しい」ことと「スカラ値が文献に一致する」ことが両立しない領域に入っているということです。

スクリプトの出力にもその注釈を入れてあります:

```
observed: Strouhal number St = 0.250
reference (idealized, low blockage, well-resolved): St ~ 0.16-0.18
note: this demo has D/H=0.22 blockage and omega=1.94
  near the BGK stability limit (2.0), which biases St upward;
  0.20-0.30 is the realistic range at these defaults. The vortex
  street in the PNG is the qualitative test the demo is meant for.
```

### Rayleigh-Bénard の Nu が 15 % 高めなのは境界層の解像度

`Ra = 10^5` だと熱境界層の厚さは `BL ~ Ra^(-1/3) ≈ 0.022`。デフォルトの `GRID = 128`（`NY = 64`）だと `h ≈ 0.016` で、**BL/h ≈ 1.4 セル** しか取れていません。境界層が解像できていないと Nu は上振れする、というのは標準的な振る舞いです。スクリプトに `BL/h` を計算させて出すようにして、利用者に「ここを見れば原因が分かる」状態にしました:

```
observed: Nusselt number Nu = 4.95
reference: Ra=1e4 -> Nu~2.2,  Ra=1e5 -> Nu~3.9-4.3
note: BL thickness ~ Ra^(-1/3) = 0.022,  h = 0.0159,  BL/h = 1.4
  Nu is biased high when BL/h < ~3-4; convection cells in the PNG
  are still qualitatively correct.
```

---

## 学んだこと — 「デモサイズ vs 文献値」のトレードオフ

このサンプルで一番大きい学びは、**「絵が正しい」と「スカラ値が文献に一致する」は別物で、どちらを優先するかが load-bearing な設計判断になる**、ということでした。Sod とキャビティが「デフォルトで文献に当たる」のは偶然ではなく、観測量がもともと**デモサイズに頑健**だからです:

- Sod 衝撃波位置 → 厳密 Riemann 解との比較。グリッドが粗くても収束する性質
- Ghia キャビティ Re=100 → `GRID=64` でも収束する古典的な検証問題

一方、LBM の Strouhal と Rayleigh-Bénard の Nu は、**閉塞率・omega・BL/h** といったデモ予算（1 分以内に終わる解像度）が制約する数値ノブに敏感です。次回 GPU デモを書く人のために、内部用の [postmortem](https://github.com/crowdy/conoha-cli-app-samples/blob/main/docs/postmortems/2026-05-14-slurm-rest-api-gpu-worker.md) にこのトレードオフを **G6-G8** として残しました。

ほかにも実機検証で踏んだ「コードを読むだけでは見抜けない」トラップが 5 件あります。新規 GPU サンプルを書くときの参考にどうぞ:

| # | 罠 | 対処 |
|---|------|------|
| G1 | giovtorres イメージの slurmd が **NVML 非リンク** → ノードが `INVALID_REG` | `entrypoint-gpu.sh` で `gres.conf` を起動時に自動生成 |
| G2 | `slurmrestd` の `--gres` 相当フィールドは **`tres_per_node`** で、`tres_per_task` だと error 2072 で蹴られる | payload は `tres_per_node="gres/gpu:1"` |
| G3 | `deploy.resources.reservations.devices` は **swarm モード不要**（古い直感が stale） | docker-compose v2 でそのまま動く |
| G4 | `conoha gpu setup` がドライバ 595 を入れた後 `nvidia-utils-535` を pin して **NVML バージョン不整合** | `nvidia-utils-595-server` で userspace を kernel に揃える |
| G5 | sslip.io が Let's Encrypt の **weekly rate limit** に当たることがある | 自前ドメイン推奨。検証は SSH トンネルで代替可 |

---

## まとめ

最終的に手に入ったもの:

| 機能 | 状況 |
|------|------|
| L4 GPU を計算ノードとして使う Single-VPS Slurm cluster | `conoha app deploy` 1 発（前回のサンプルに gpu-worker が 1 個生えただけ） |
| `--gres gpu:1 --partition gpu` で torch ジョブを REST API 経由で submit | `slurmrestd v0.0.42` の `tres_per_node` で実装 |
| 4 種類の CFD ワークロード（Sod / キャビティ / LBM / Rayleigh-Bénard） | 全部 self-contained な torch スクリプト、CPU フォールバック付き |
| 結果 PNG のローカル回収 | `slurm_cli.py fetch <JOB_ID> --server <name> --identity <key>` |
| 観測値 vs 文献値の正直な評価 | 2/4 で完全一致、2/4 はデモサイズ起因の上振れを inline 注釈で開示 |

前回の繰り返しになりますが、今回も「ローカルの `docker compose up` で通った」だけでは出ない不具合が、`conoha app deploy` 経路で初めて出ました（特に G1 と G2）。**実機での `conoha app deploy` 経由検証を最後にもう一周回す**のは、毎回やる価値があります。

GPU を 1 枚足すだけでこれだけ遊べる範囲が広がるので、L4 を持っている方はぜひ試してみてください。GitHub の issue / PR でフィードバックいただけるとうれしいです。L4 はランニングが高めなので、検証が終わったら `conoha server delete --delete-boot-volume --yes <name>` で必ず破棄してください。

### 参考

- [crowdy/conoha-cli-app-samples — slurm-rest-api サンプル](https://github.com/crowdy/conoha-cli-app-samples/tree/main/slurm-rest-api)
- [前作: Slurm REST API + JWT を ConoHa VPS3 に立てる](https://qiita.com/crowdy/items/4a6bc40c06205f4acf68)
- [PR #103 — feat(slurm-rest-api): add L4 GPU compute node](https://github.com/crowdy/conoha-cli-app-samples/pull/103)
- [PR #104 — feat(slurm-rest-api): add 4 CFD workload examples + fetch command](https://github.com/crowdy/conoha-cli-app-samples/pull/104)
- [postmortem: L4 GPU 計算ノード追加で踏んだ落とし穴](https://github.com/crowdy/conoha-cli-app-samples/blob/main/docs/postmortems/2026-05-14-slurm-rest-api-gpu-worker.md)
- [giovtorres/slurm-docker-cluster](https://github.com/giovtorres/slurm-docker-cluster) — JWT 入りの maintained Slurm Docker image
- [Slurm Workload Manager — Generic Resource (GRES) Scheduling](https://slurm.schedmd.com/gres.html)
- [Ghia, U., Ghia, K.N. and Shin, C.T. (1982) — High-Re Solutions for Incompressible Flow Using the Navier-Stokes Equations and a Multigrid Method](https://www.sciencedirect.com/science/article/pii/0021999182900584)
- [Jonas Latt — lbmFlowAroundCylinder（参考実装）](https://palabos.unige.ch/get-started/python-examples-2d-and-3d-fluid-flows)
- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)
