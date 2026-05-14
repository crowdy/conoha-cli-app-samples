# slurm-rest-api CFD ワークロード例 — 設計

- **日付:** 2026-05-14
- **対象サンプル:** `slurm-rest-api/`(`examples/workloads/` への追加)
- **前提:** PR #103(`feat/slurm-rest-api-gpu-worker` — L4 GPU 計算ノード `gpu-worker` の追加)
- **想定フレーバー:** `g2l-t-c20m128g1-l4`(NVIDIA L4)
- **ステータス:** Design(実装前)
- **公開予定:** Qiita 記事の題材。`examples/workloads/README.md` の 4 セクションがそのまま記事本文の骨子になるよう書く。

## 1. 背景と目的

`slurm-rest-api` サンプルは PR #99 / #101 で CPU 版、PR #103 で L4 GPU 計算ノード(`gpu-worker`)が入った。現状の同梱ワークロードは `numpy_matmul.py`(行列積ベンチ)・`hyperparam_sweep.py`(sklearn 配列ジョブ)・`torch_gpu_check.py`(GPU 可視性チェック)で、いずれも「ジョブスケジューラが動くこと」の確認用であって、**実際の科学計算ワークロード**ではない。

本作業の目的は、**流体力学(CFD)の問題を解く Python スクリプトを Slurm ジョブとして登録し、結果(フィールドの可視化 PNG)を回収する**一連の流れを、実用的な 4 つの題材で示すこと。これにより:

1. `gpu-worker`(L4 + torch)が「GPU 可視性チェック」を超えて、本物の数値計算をスケジュールできることを示す
2. ジョブの「結果」がスカラーではなくフィールド(速度・圧力・温度・渦度)である場合の、結果回収のパターンを確立する
3. Qiita 記事「ConoHa L4 GPU で Slurm REST API から流体シミュレーションをジョブ実行する」の題材にする

非目標:本格的な CFD ソルバーライブラリ化、マルチ GPU 分散、メッシュ生成、非構造格子。これらは "Out of Scope" 節に明記。

## 2. スコープ

`examples/workloads/` に 4 つの CFD ワークロードスクリプトを追加する:

| スクリプト | 問題 | 数値手法 |
|---|---|---|
| `cfd_lbm_cylinder.py` | 円柱周りの流れ(von Kármán 渦列) | D2Q9 格子ボルツマン法(BGK) |
| `cfd_lid_cavity.py` | リッド駆動キャビティ | 非圧縮 Navier-Stokes(渦度-流れ関数) |
| `cfd_sod_shock.py` | Sod 衝撃管 | 1D 圧縮性 Euler(有限体積 + HLL) |
| `cfd_rayleigh_benard.py` | Rayleigh-Bénard 熱対流 | 2D Boussinesq(渦度-流れ関数 + 温度輸送) |

共通の決定事項(ブレインストーミングで確定):

- **全て `gpu` パーティションで torch 実行。** 各スクリプトは `device = "cuda" if torch.cuda.is_available() else "cpu"`。`gpu` パーティション前提だが、ローカル開発のため CPU フォールバック可。
- **結果回収は「matplotlib PNG + `slurm_cli.py fetch` コマンド」。** 共有ボリュームは追加しない。
- **検証は「観測値 + 文献範囲の表示」。** hard PASS/FAIL のアサーションは置かない。読者が数値と PNG を見て判断する。
- **4 スクリプトは完全に独立した inline スクリプト。** 共有モジュールは作らない(`--inline` submit はソースを heredoc で埋め込むため self-contained 必須。既存ワークロードと同じ制約)。プロット・レポート整形の ~15 行程度の重複は許容する。

## 3. アーキテクチャ・ファイル構成

### 新規ファイル(`slurm-rest-api/examples/workloads/`)

- `cfd_lbm_cylinder.py`
- `cfd_lid_cavity.py`
- `cfd_sod_shock.py`
- `cfd_rayleigh_benard.py`

各スクリプトの共通規約:

- self-contained、torch ベース。`import` は標準ライブラリ + `torch` + `matplotlib` のみ。
- シミュレーションパラメータは**環境変数**から読む(`RE` / `RA` / `PR` / `GRID` / `STEPS` / `CELLS` / `TEND` 等)。デフォルトは L4 で 1 分以内に終わるデモサイズ。env で上げれば本格解像度でも回せる。
- `matplotlib.use("Agg")` を pyplot import 前に呼ぶ(コンテナにディスプレイなし)。
- stdout に出力:シミュレーションメタ(格子・ステップ・elapsed・device 名)+ **主要な物理観測量とその文献範囲**。
- フィールド可視化 PNG を `/tmp/slurm-${SLURM_JOB_ID}.png` に書く。`SLURM_JOB_ID` 未設定時(Slurm 外のローカル実行)は `cfd-<script-stem>.png` にフォールバックし、スクリプト単体でも動く。

### 新規ファイル(`slurm-rest-api/examples/cli/`)

- `slurm_client/fetch.py` — 純粋関数 `build_fetch_command(...)`(argv リストを返す。単体テスト対象)+ 薄い `fetch_result(...)`(subprocess 実行)。

### 修正ファイル

- `slurm-rest-api/Dockerfile` — gpu ステージに `matplotlib` を追加(cpu ステージは変更なし)。
- `slurm-rest-api/examples/cli/slurm_cli.py` — `fetch` サブコマンドを追加(click のワイヤリングのみ)。
- `slurm-rest-api/examples/cli/tests/test_fetch.py` — `build_fetch_command` の単体テスト(新規)。
- `slurm-rest-api/examples/workloads/README.md` — 4 ワークロードのセクションを追加。
- `slurm-rest-api/README.md` — quick start に CFD ワークロードと `fetch` の 1 行を追加。

### データフロー

```
slurm_cli.py submit cfd_lbm_cylinder.py --partition gpu --gres gpu:1 --inline
  → POST /job/submit(ソースを heredoc で埋め込み)
  → gpu-worker が L4 で torch 実行
      → /tmp/slurm-<id>.png(フィールド可視化)
      → /tmp/slurm-<id>.out(stdout: メタ + 観測値 vs 文献範囲)
slurm_cli.py status <id>                       → COMPLETED
slurm_cli.py logs   <id>                       → (既存)stdout を見る docker exec コマンドを出力
slurm_cli.py fetch  <id> --server <name> --identity <key>
  → conoha server ips <server> で IPv4 解決
  → ssh -i <key> root@<ip> 'docker exec $(...gpu-worker...) cat /tmp/slurm-<id>.png'
  → ローカル ./slurm-<id>.png に保存
```

## 4. 4 つのソルバー

各ソルバーの数値手法・PNG 内容・観測量(文献範囲)・ランタイム。デフォルト値は全て L4 で 1 分以内に完了する想定。

### 4.1 `cfd_lbm_cylinder.py` — 円柱周りの流れ

- **手法:** D2Q9 格子ボルツマン法、BGK 衝突。streaming = `torch.roll`、collision = elementwise。全てテンソル演算で GPU 親和的。
- **格子/ステップ:** デフォルト 520×180、約 30,000 ステップ。env: `RE`(デフォルト 150)、`GRID`、`STEPS`。
- **PNG:** 渦度フィールドのカラーマップ。円柱後方に交互に放出される渦列。
- **観測量:** Strouhal 数 `St = f·D/U`(後流の速度プローブ時系列を FFT して渦放出周波数 `f` を求める)。文献:Re ≈ 100–200 で **St ≈ 0.16–0.18**。
- **ランタイム:** L4 で約 20–40 秒。

### 4.2 `cfd_lid_cavity.py` — リッド駆動キャビティ

- **手法:** 非圧縮 Navier-Stokes、渦度-流れ関数定式化。渦度輸送方程式 + 流れ関数の Poisson 方程式(Jacobi 反復を torch の畳み込みで — GPU で完全並列、SOR の逐次依存を避ける)。正方キャビティに最も素直。
- **格子/ステップ:** デフォルト 256×256、定常状態まで反復。env: `RE`(デフォルト 100)、`GRID`。
- **PNG:** 流線 + 流れ関数の等高線。主渦 + コーナー渦。
- **観測量:** 鉛直中心線上の u 速度プロファイルの最小値、または主渦中心の位置。文献(Ghia et al. 1982、Re=100):中心線 **min u ≈ −0.21**、主渦中心 **≈ (0.617, 0.738)**。
- **ランタイム:** L4 で約 10–30 秒。

### 4.3 `cfd_sod_shock.py` — Sod 衝撃管

- **手法:** 1D 圧縮性 Euler、有限体積 + HLL フラックス(衝撃の解像度が Lax-Friedrichs より良く、実装も単純)。1D のため GPU の利得は小さいが、「全て gpu パーティション」の決定どおり cuda テンソルで実行。
- **格子/ステップ:** デフォルト 2,000 セル、t = 0.2 まで。env: `CELLS`、`TEND`。
- **PNG:** 最終時刻の密度・速度・圧力プロファイル。**厳密 Riemann 解を重ねて**表示。
- **観測量:** 衝撃波位置・接触不連続位置(厳密解と比較)。文献:厳密 Riemann 解が基準(スクリプト内で計算)。例:「衝撃波 x=0.85、厳密解 0.850」。
- **ランタイム:** L4 で 10 秒未満。

### 4.4 `cfd_rayleigh_benard.py` — Rayleigh-Bénard 熱対流

- **手法:** 2D Boussinesq 近似、渦度-流れ関数 + 温度輸送方程式。下面加熱・上面冷却。
- **格子/ステップ:** デフォルト 256×128、対流セルが発達するまで。env: `RA`(デフォルト 1e5)、`PR`(デフォルト 0.71)、`GRID`。
- **PNG:** 温度フィールド + 速度ベクトル。対流ロールのパターン。
- **観測量:** Nusselt 数 `Nu`(熱輸送比)。文献:Ra=1e4 で **Nu ≈ 2.2**、Ra=1e5 で **Nu ≈ 3.9–4.3**、対流開始の臨界 **Ra_c ≈ 1708**。
- **ランタイム:** L4 で約 20–40 秒。

## 5. CLI `fetch` コマンド

```
slurm_cli.py fetch <JOB_ID> --server <name> [--identity <key>] [-o <path>] [--remote-path <p>]
```

| 引数/オプション | デフォルト | 説明 |
|---|---|---|
| `JOB_ID` | (必須) | 結果を回収するジョブ ID |
| `--server` | (必須) | conoha サーバー名(IP 解決に使う) |
| `--identity` | SSH 既定 | SSH 秘密鍵パス |
| `-o` / `--output` | `./slurm-<id>.png` | ローカル保存パス |
| `--remote-path` | `/tmp/slurm-<id>.png` | コンテナ内パス(PNG 以外も回収できるよう) |

### メカニズム

1. `conoha server ips <server>` で IPv4 を解決する。
2. `ssh -i <identity> root@<ip> 'docker exec $(docker ps -qf label=com.docker.compose.service=gpu-worker | head -1) cat <remote-path>'` の標準出力をローカルファイルにリダイレクトする(バイナリ安全)。

### なぜ `conoha server ssh` ラッパーではなく plain `ssh` か

`conoha server ssh` は標準出力に `Connecting to root@...` のバナーを出すため、バイナリの PNG ストリームを汚染する(本検証セッションで実際に観測)。IP を `conoha server ips` で別途解決してから plain `ssh` を使えば、標準出力は純粋なファイルバイトのみになる。コンテナの探索は `get-token.sh` と同じく `com.docker.compose.service` ラベルで行い、compose プロジェクト名に依存しない(postmortem C4 の教訓)。

### 構造

`slurm_client/fetch.py`:

- `build_fetch_command(ip, identity, remote_path, ssh_user="root") -> list[str]` — 純粋関数。ssh の argv リストを返す。単体テスト対象。
- `fetch_result(server, job_id, identity, output, remote_path) -> None` — IP 解決 → `build_fetch_command` → subprocess 実行 → ファイル書き出し。

`slurm_cli.py` は click コマンドのワイヤリングのみ。

### エラー処理

- ジョブが未 COMPLETED / CFD ジョブでない → リモートファイル無し → `result file not found at <path> — is job <id> a completed CFD workload?`
- ssh 失敗 → ssh の stderr をそのまま出す。
- gpu-worker コンテナが見つからない → `no gpu-worker container running on <server>`。

## 6. イメージ変更

`slurm-rest-api/Dockerfile` の gpu ステージ:

```dockerfile
FROM cpu AS gpu
RUN python3 -m pip install --no-cache-dir torch matplotlib
COPY entrypoint-gpu.sh /usr/local/bin/entrypoint-gpu.sh
RUN chmod +x /usr/local/bin/entrypoint-gpu.sh
ENTRYPOINT ["/usr/local/bin/entrypoint-gpu.sh"]
```

`matplotlib` の 1 行追加のみ。cpu ステージ(numpy + sklearn)は変更しない — matplotlib は gpu-worker でのみ必要。

## 7. ワークロード側のエラー処理

- `matplotlib.use("Agg")` を pyplot import 前に呼ぶ。
- `device = "cuda" if torch.cuda.is_available() else "cpu"`、どちらかを stdout に明記する。
- PNG パスは `SLURM_JOB_ID` env から。未設定時は `cfd-<script-stem>.png` にフォールバック。
- **発散検出:** ソルバーが NaN/Inf に至ったら、ゴミの PNG を書かずに `divergence detected at step N — reduce timestep / Re` を出力して非ゼロ終了する。明示的な CFL 違反ガードを置く。

## 8. テスト戦略(3 段階)

1. **単体テスト**(`examples/cli/tests/test_fetch.py`):`build_fetch_command` の純粋関数 — identity の有無、カスタム output/remote-path ごとの argv 構成を検証。mock 不要。
2. **ローカル CPU セルフチェック:** 各 CFD スクリプトは小さい格子 env(例 `GRID=64 STEPS=500`)で CPU 上数秒以内に実行可能 — 実行できるか・PNG が生成されるか・観測値が妥当か を確認。`examples/workloads/README.md` にスクリプトごとに 1 行ずつ文書化する。
3. **実 L4 検証**(postmortem 必須ゲート):L4 に `conoha app deploy` → 4 つ全てを `slurm_cli.py submit --partition gpu --gres gpu:1` で投入 → COMPLETED 確認 → 各 PNG を `fetch` → **各観測量が文献範囲に入るか**を確認。これが「本当に解けたか」のゲート。

### 明示的にやらないこと

- **`smoke_test.py` は変更しない**(8/8 を維持)。4 つの CFD ジョブを smoke_test に入れると重く遅くなる — CFD 検証は workloads README の別ウォークスルーに分離する。
- CFD スクリプトを import 可能なモジュールにリファクタリングしない — inline-submit パターン(ファイル全体を heredoc で埋め込む)と整合し、「スクリプトはスクリプト」の単純さを保つ。正確性の検証は観測値-文献範囲の出力が担う。

## 9. Out of Scope

- 本格的な CFD ソルバーのライブラリ化、再利用可能な共通モジュール。
- マルチ GPU / 分散シミュレーション。
- メッシュ生成、非構造格子、適合格子細分化(AMR)。
- 3D シミュレーション(全て 2D もしくは 1D)。
- リスタート / チェックポイント。
- 共有書き込み可能 jobdir の追加(`fetch` は SSH サイドチャネルで回収する設計)。

## 10. Definition of Done

- [ ] 4 つの `cfd_*.py` が `examples/workloads/` に追加され、それぞれローカル CPU セルフチェック(小格子 env)で実行でき PNG を生成する。
- [ ] `Dockerfile` gpu ステージに `matplotlib` が入り、gpu イメージがビルドできる。
- [ ] `slurm_cli.py fetch` が実装され、`build_fetch_command` の単体テストが通る。
- [ ] L4 VPS で `conoha app deploy` → 4 つ全てを gpu パーティションに submit → COMPLETED。
- [ ] 各ジョブの PNG を `slurm_cli.py fetch` でローカルに回収できる。
- [ ] 各ジョブの観測量(St / min-u / 衝撃波位置 / Nu)が stdout に出力され、文献範囲内に収まる。
- [ ] 既存の smoke test が依然 8/8 PASS(回帰なし)。
- [ ] `examples/workloads/README.md` に 4 セクション、`README.md` の quick start に CFD の 1 行。
- [ ] L4 VPS は検証後 `conoha server delete --delete-boot-volume --yes` で破棄。
- [ ] PR 本文に `conoha app deploy` 経路の submit → fetch ログ(4 ジョブ分の観測量を含む)を貼る。
