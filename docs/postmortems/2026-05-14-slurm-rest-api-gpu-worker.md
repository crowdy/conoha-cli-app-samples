# `slurm-rest-api` GPU worker — L4 計算ノード追加で踏んだ落とし穴

- **対象サンプル**: `slurm-rest-api/` (`gpu-worker` 追加)
- **関連 Issue / PR**: [#102](https://github.com/crowdy/conoha-cli-app-samples/issues/102), [#103](https://github.com/crowdy/conoha-cli-app-samples/pull/103)
- **検証日**: 2026-05-14
- **前提資料**: [2026-05-14-slurm-rest-api-12-bugs.md](2026-05-14-slurm-rest-api-12-bugs.md) — CPU 版の 12+4 件。本ドキュメントはその続編で、**GPU 計算ノードを足すときに固有で踏む罠**だけを切り出したもの。

CPU 版の postmortem の「教訓」(特に「`docker compose up` だけで合格にしない」「関連リポジトリのソースまで読む」) は GPU 版でも全部効いた。ここに足すのは、GPU 版を書いて**初めて顕在化した 5 件**。いずれも実機 L4 (`g2l-t-c20m128g1-l4`) で `conoha app deploy` を通して出てきたもので、コードレビューやローカル `docker compose up` では絶対に出ない。

---

## G1. giovtorres イメージの slurmd は NVML 非リンク — `gres.conf` を自前で用意する

`giovtorres/slurm-docker-cluster:25.11.4` の entrypoint には `slurmd-gpu` モードがあり、`/dev/nvidiaN` を数えて `slurmd -Z --conf "Feature=gpu Gres=gpu:nvidia:N"` で動的登録する。ここまでは Issue の前提どおり。

しかし **slurmd 本体が NVML とリンクされていない**。`ldd /usr/sbin/slurmd | grep -i nvml` は空。つまり slurmd の `gres/gpu` プラグインは GPU を自動列挙できず、`/etc/slurm/gres.conf` が無いと:

```
State=IDLE+DRAIN+DYNAMIC_NORM+INVALID_REG
Reason=gres/gpu count reported lower than configured (0 < 1)
```

ノードが `INVALID_REG` になり、`--gres` 付きの submit は全て **error 2072 "Invalid generic resource (gres) specification"** で蹴られる。`Gres=gpu:nvidia:1` は scontrol の表示には出るので「登録できてる」と誤認しやすい。

**対処**: `gpu-worker` 専用の entrypoint ラッパー (`entrypoint-gpu.sh`) を被せ、起動時に `/dev/nvidiaN` を列挙して `gres.conf` を生成してから upstream entrypoint を exec する。`NodeName=g[1-64]` で全 replica をカバー。

教訓: **GPU サンプルをこのベースイメージで書くなら `gres.conf` の materialize は必須作業**。autodetect されると思って省くと、ノードは「見えてるのにスケジュールされない」サイレント故障になる。

## G2. slurmrestd v0.0.42 の `--gres` 相当フィールドは `tres_per_node` — `tres_per_task` ではない

sbatch の `--gres=gpu:1` を REST API に載せるとき、最初 `tres_per_task: "gres/gpu:1"` にしたら error 2072。実機で各フィールドを総当たりした結果:

| フィールド | 値 | 結果 |
|---|---|---|
| `tres_per_task` | `gres/gpu:1` | ✗ 2072 Invalid gres |
| `tres_per_node` | `gres/gpu:1` | ✓ job_id 返る |
| `tres_per_job`  | `gres/gpu:1` | ✓ job_id 返る |
| (どれでも) | `gpu:1` (prefix なし) | ✗ Invalid TRES |

`sbatch --gres` は **per-node** 割り当て扱いなので `tres_per_node` が正しいマッピング。エラーメッセージ ("Invalid generic resource specification") はスキーマのフィールド名を一切示さないので、ドキュメントだけ読んでも `tres_per_task` と `tres_per_node` の差は見抜けない。**実機で総当たりして確定するしかない。**

## G3. compose の `deploy.resources.reservations.devices` は swarm モード不要

「`deploy:` は swarm 専用」という古い直感は stale。docker-compose v2 (今回は Compose 29.x) では `deploy.resources.reservations.devices` で NVIDIA GPU を要求するのが正規の書き方で、`docker compose up` 単体で効く。`gpus: all` のショートハンドも使えるが、リポジトリ内の他の GPU サンプル (`vllm-gpu` / `hunyuan3d-gpu` / `fish-speech-tts-gpu`) が全部 `deploy.resources.reservations.devices` を使っているので踏襲した。

## G4. `conoha gpu setup` はドライバ 595 を入れて `nvidia-utils-535` を pin する — バージョン不整合

`conoha gpu setup` を流すと:
1. `ubuntu-drivers install --gpgpu` が **open-kernel 595** ドライバを入れる
2. その後の検証ステップが **`nvidia-utils-535-server`** を入れ、535 の compute lib で 595 を上書きする

結果 `nvidia-smi` が:

```
Failed to initialize NVML: Driver/library version mismatch
NVML library version: 535.288
```

kernel module は 595、userspace は 535 でズレる。**対処**: `apt-get install nvidia-utils-595-server libnvidia-compute-595-server` で userspace を kernel に合わせる。これは conoha-cli 側の `gpu setup` のバグ候補なので、サンプル READMEには注意書きを入れた上で、本来は conoha-cli にも別途報告すべき。

## G5. sslip.io は Let's Encrypt の weekly rate limit に当たりやすい

`<ip>.sslip.io` で HTTPS を張ろうとしたら ACME が:

```
HTTP 429 rateLimited - too many certificates (250000) already issued for "sslip.io" in the last 168h
```

`sslip.io` は共有ドメインなので LE の "certificates per registered domain" 上限に他人と一緒に当たる。検証は SSH トンネルで slurm-edge の host ポートを直叩きして回避した (proxy → slurmrestd の経路自体は同一)。**教訓**: GPU サンプルに限らず、実機検証で TLS まで通したいなら自前ドメイン + A レコードを使うのが確実。sslip.io は「運が良ければ通る」前提で。

---

## G6-G8. CFD ワークロード追加 (PR #104) で見つけた「デモサイズ vs 文献値」の罠

PR #104 では 4 つの CFD ソルバー (Sod 衝撃管・リッド駆動キャビティ・LBM 円柱・Rayleigh-Bénard) を L4 上で走らせ、各観測量を文献値と並べて出力する設計にした。Sod (衝撃位置) と キャビティ (Ghia の min-u) は **デフォルト設定で文献値と一致**したが、LBM の Strouhal 数 と RB の Nusselt 数 は **デフォルトで文献範囲を外れた**。デバッグの過程で見えた共通構造を残す。

### G6. LBM の Strouhal 数は閉塞率と BGK omega に強く依存する

L4 で `cfd_lbm_cylinder.py` (`GRID_X=520 GRID_Y=180 Re=150 STEPS=60000`) を走らせると St=0.250 と出る。教科書値は St≈0.16-0.18。FFT 帯域フィルタ [0.05, 0.30] や プローブ位置をオフセンターに変えても結果は変わらない — **0.25 がこの設定での真の支配周波数**。原因:

- **閉塞率 D/H = 40/180 = 0.22** が大きい。文献の St はほぼ自由流での値。閉塞があると有効速度が上がり St も上がる。
- **omega = 1/(3·nulb + 0.5) ≈ 1.94** が BGK 安定限界 (2.0) に近い。粘性が極小 (nulb ≈ 0.005) で、実効 Re は名目 150 より大きい。

教訓: **「1 分の L4 予算」を尊重しつつ「文献値一致」を期待すると、両方を満たせない領域に押し込まれる。** デモを書く側は (a) スクリプトの reference 出力にデモ固有の補正範囲を併記する、もしくは (b) 観測量自体を「閉塞率・omega に頑健なもの」に取り替える。今回は (a) を採用 (`cfd_lbm_cylinder.py` の reference 出力で D/H と omega を併記)。

### G7. Rayleigh-Bénard の Nu はデフォルト解像度では境界層を解像しきれない

`cfd_rayleigh_benard.py` (`GRID=128 RA=1e5 STEPS=20000`) で Nu=4.95、文献は 3.9-4.3 (Ra=1e5 で)。**高 Ra では熱境界層厚さ BL ~ Ra^(-1/3) ≈ 0.022**、NY=64 で h ≈ 0.016、BL/h ≈ 1.4 — つまり境界層をたった 1-2 セルしか解像していない。Nu が 15% 程度上振れする標準的なパターン。

教訓: **2D で境界層支配の問題 (Rayleigh-Bénard・高 Re チャネル流) を Qiita デモにするなら、(Ra, N) は BL/h ≥ ~4 を満たすペアを選ぶ、もしくはスクリプト自身が BL/h の値を計算して出力する**。今回は後者を採用 (`cfd_rayleigh_benard.py` の出力に `BL/h = 1.4` を明示)。

### G8. (メタ教訓) デモ・サイジングに頑健な観測量を選ぶこと自体が設計判断

Sod と キャビティが デフォルトで文献値を打ったのは偶然ではない:

- **Sod の衝撃位置** は厳密 Riemann 解との比較。グリッドが粗くても収束する性質の量。
- **キャビティの min-u (Ghia Re=100)** は GRID=64 でも収束する古典的な検証問題。

一方:

- **LBM の St** は閉塞率と omega への感度が高い。
- **RB の Nu** は BL/h への感度が高い。

「`gpu` パーティションで torch ジョブを回す」というデモの本旨を満たす ためなら、どの観測量を「文献値と並べて出す」かは load-bearing な設計判断。**「絵が文献通り」と「スカラが文献通り」は別物** — 前者を撮りたいだけならどちらの観測量でも良いが、後者まで出すならその観測量がデモ予算と両立するかを事前に確認する。

---

## まとめ表

| # | 罠 | 検出経路 | 対処 |
|---|------|---------|------|
| G1 | giovtorres slurmd が NVML 非リンク → `INVALID_REG` | 実 L4 `conoha app deploy` | `entrypoint-gpu.sh` で `gres.conf` 自動生成 |
| G2 | `--gres` は `tres_per_node`、`tres_per_task` は 2072 | 実機でフィールド総当たり | payload を `tres_per_node` に |
| G3 | `deploy.devices` は swarm 不要 (古い直感が stale) | 既存 GPU サンプル照合 | `deploy.resources.reservations.devices` 採用 |
| G4 | `conoha gpu setup` のドライバ/userspace バージョン不整合 | 実機 `nvidia-smi` | `nvidia-utils-595-server` で揃える (conoha-cli 側バグ候補) |
| G5 | sslip.io が LE weekly rate limit | 実機 ACME ログ | 自前ドメイン推奨、検証は SSH トンネルで代替可 |
| G6 | LBM の St は閉塞率と BGK omega に強く依存し、デモサイズではテキストブック値 0.17 を打たない | 実 L4 で St=0.25 観測、FFT 帯域フィルタ・プローブ位置で変わらず | スクリプト出力にデモ固有の補正範囲を併記 |
| G7 | RB の Nu は境界層 BL ~ Ra^(-1/3) を満たすセル数が足りないと上振れする | 実 L4 で Nu=4.95 (vs lit 3.9-4.3 at Ra=1e5)、BL/h=1.4 | スクリプトに BL/h を出力させ、文献比較には粗解像度の限界を明示 |
| G8 | 「絵が文献通り」と「スカラが文献通り」は別物 — どの観測量を出すかが load-bearing な設計判断 | 4 観測量のうち 2 つだけがデフォルトで文献値一致 | デモサイズに頑健な観測量 (Sod 衝撃位置・Ghia min-u) を優先採用 |

## 次に GPU サンプルを書く人へのチェックリスト

1. ベースイメージの slurmd が NVML リンク済みか `ldd` で確認。していなければ `gres.conf` を自前で用意する設計を最初から入れる。
2. REST API の GRES フィールドは**実機で総当たり**して確定する。エラーメッセージはフィールド名を教えてくれない。
3. `conoha gpu setup` 後は必ず `nvidia-smi` を実機で叩く。"version mismatch" が出たら userspace パッケージをドライバに合わせる。
4. 実機検証で TLS まで通すなら自前ドメインを用意する。sslip.io 頼みにしない。
5. CPU 版 postmortem の教訓は全部そのまま効く — 特に「`docker compose up` だけで合格にしない」。G1/G2/G4 はローカル compose up では一切出なかった。
6. **観測量を文献値と並べる前に、デフォルト設定がその観測量で文献値に届くか実機検証で確認する**。届かないなら (a) デモ設定を文献領域に寄せる、(b) 観測量をデモに頑健なものに替える、(c) スクリプト出力でデモ固有の補正値を併記する、のどれかを選ぶ。「文献範囲外」を放置して PR を出すと、Qiita 読者がスクリプトのバグを疑う。
