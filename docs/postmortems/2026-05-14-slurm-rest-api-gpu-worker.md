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

## まとめ表

| # | 罠 | 検出経路 | 対処 |
|---|------|---------|------|
| G1 | giovtorres slurmd が NVML 非リンク → `INVALID_REG` | 実 L4 `conoha app deploy` | `entrypoint-gpu.sh` で `gres.conf` 自動生成 |
| G2 | `--gres` は `tres_per_node`、`tres_per_task` は 2072 | 実機でフィールド総当たり | payload を `tres_per_node` に |
| G3 | `deploy.devices` は swarm 不要 (古い直感が stale) | 既存 GPU サンプル照合 | `deploy.resources.reservations.devices` 採用 |
| G4 | `conoha gpu setup` のドライバ/userspace バージョン不整合 | 実機 `nvidia-smi` | `nvidia-utils-595-server` で揃える (conoha-cli 側バグ候補) |
| G5 | sslip.io が LE weekly rate limit | 実機 ACME ログ | 自前ドメイン推奨、検証は SSH トンネルで代替可 |

## 次に GPU サンプルを書く人へのチェックリスト

1. ベースイメージの slurmd が NVML リンク済みか `ldd` で確認。していなければ `gres.conf` を自前で用意する設計を最初から入れる。
2. REST API の GRES フィールドは**実機で総当たり**して確定する。エラーメッセージはフィールド名を教えてくれない。
3. `conoha gpu setup` 後は必ず `nvidia-smi` を実機で叩く。"version mismatch" が出たら userspace パッケージをドライバに合わせる。
4. 実機検証で TLS まで通すなら自前ドメインを用意する。sslip.io 頼みにしない。
5. CPU 版 postmortem の教訓は全部そのまま効く — 特に「`docker compose up` だけで合格にしない」。G1/G2/G4 はローカル compose up では一切出なかった。
