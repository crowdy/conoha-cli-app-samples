# Slurm REST API サンプル — 設計

- **日付:** 2026-05-13
- **対象サンプル:** `slurm-rest-api/`
- **想定フレーバー:** `g2l-t-2` (2GB)
- **ステータス:** Design (実装前)

## 1. 背景と目的

`conoha-cli-app-samples` には現在、HPC ジョブスケジューラ系のサンプルがない。Slurm は学術・研究用途で広く使われており、ConoHa VPS3 上で「Slurm クラスター + REST API (slurmrestd) を最小構成で動かす」サンプルがあると、AI/ML 推論サンプル (`vllm-gpu`, `fish-speech-tts-gpu`) と組み合わせた HPC 風ワークロード検証の入口になる。

このサンプルの目的：

1. ConoHa VPS3 上に Slurm 単一ノードクラスターを Docker Compose で立ち上げる
2. slurmrestd (REST API) を JWT 認証付きで HTTPS 公開する
3. Python CLI クライアントから API 経由でジョブ submit / status / cancel / logs / 配列ジョブ を実行できる
4. 実際の計算ワークロード (NumPy / scikit-learn) を例として同梱する

非目標：マルチユーザー認可、自動 JWT リフレッシュ、GPU スケジューリング、HA controller、ジョブごとのコンテナ隔離。これらは "Out of Scope" 節に明記。

## 2. アーキテクチャ概要

```
                       HTTPS (Caddy / conoha proxy)
                                    |
                                    v
                  +-----------------+-----------------+
                  | slurm  (web service, blue_green:false)
                  |   munged + slurmctld + slurmd     |
                  |   slurmrestd :6820  (JWT auth)    |
                  |   python3 / numpy / scikit-learn  |
                  +-----+-----------------------+-----+
                        | munge key             | JWT HS256 key
                        | (shared volume)       | (in-container only)
                        v                       v
                  +-----+------+         +------+------+
                  | slurmdbd   |<------->| (slurmctld) |
                  | :6819      |  munge  |             |
                  +-----+------+         +-------------+
                        |
                        v MySQL/3306
                  +-----+------+
                  | mariadb:11 |
                  +------------+
```

サービス 3 つ：

| サービス | 役割 | 種別 | 公開 |
|----------|------|------|------|
| `slurm` | munged + slurmctld + slurmd + slurmrestd + Python runtime | `web` (blue_green: false) | HTTPS (Caddy) → :6820 |
| `slurmdbd` | アカウンティングデーモン | `accessory` | 内部のみ (slurm ↔ slurmdbd の munge 認証) |
| `mariadb` | `slurm_acct_db` ストレージ | `accessory` | 内部のみ |

**blue/green を web も含めて無効化する理由:** Slurm は実行中ジョブ・キュー・accounting DB すべてが状態を持つ。スロット 2 つが同時に slurmctld を起動すると munge / DB / JWT 鍵を奪い合って壊れる。`outline` / `gitea` と同じ stateful 単一インスタンスパターン。

## 3. ディレクトリレイアウト

```
slurm-rest-api/
├── README.md
├── compose.yml
├── conoha.yml
├── Dockerfile                       # all-in-one Slurm + Python runtime
├── slurm/
│   ├── slurm.conf                   # 単一ノードクラスター定義
│   ├── cgroup.conf
│   ├── slurmdbd.conf
│   └── entrypoint.sh                # munge / JWT 鍵 / 各デーモン起動
├── slurmdbd/
│   └── Dockerfile                   # slurm イメージ再利用 + entrypoint 分岐
├── examples/
│   ├── cli/
│   │   ├── slurm_cli.py             # click + requests
│   │   ├── requirements.txt
│   │   └── README.md
│   ├── workloads/
│   │   ├── numpy_matmul.py
│   │   ├── hyperparam_sweep.py
│   │   └── README.md
│   └── get-token.sh                 # SSH → docker exec → scontrol token
└── tests/
    └── smoke_test.py                # API ヘルス + ジョブ 1 回 submit + 完了確認
```

## 4. コンポーネント詳細

### 4.1 `slurm` コンテナ (Dockerfile)

ベース: `ubuntu:24.04`

インストール:

- `slurm-wlm` (slurmctld / slurmd 含む), `slurmrestd`, `slurm-wlm-doc` (OpenAPI 定義の参照に使用)
- `munge`
- `python3`, `python3-pip`, `python3-numpy`, `python3-scikit-learn`, `python3-requests`
- `libjwt`, `libjson-c`, `libyaml` (slurmrestd 依存)

ユーザー: `slurm` (uid 64030) を作成。slurmctld / slurmd / slurmrestd はこのユーザーで実行。

ポート: 内部 `6820` (slurmrestd) のみ `EXPOSE`。

### 4.2 `slurm/entrypoint.sh` 起動シーケンス

```
1. /etc/munge/munge.key が無ければ生成 (chmod 0400, owner munge)
   ※ 共有ボリューム /etc/munge は slurmdbd と共通マウント
2. munged を起動
3. /var/spool/slurm/jwt_hs256.key が無ければ生成 (32 バイト乱数, chmod 0600, owner slurm)
4. slurmdbd の :6819 が開くまで待つ (タイムアウト 60s, nc -z slurmdbd 6819)
5. slurmctld を foreground で起動 (-D)
6. slurmd を起動
7. slurmrestd を起動: `slurmrestd -a rest_auth/jwt 0.0.0.0:6820`
   ※ AuthAltTypes=auth/jwt と AuthAltParameters=jwt_key=/var/spool/slurm/jwt_hs256.key を slurm.conf で設定済み
8. SIGTERM を受けたら slurmrestd → slurmd → slurmctld → munged の順で停止
```

supervisord を使わず、bash の `wait -n` で全プロセスを並列監視。1 つ落ちたらコンテナ全体を再起動 (compose の restart policy で復帰)。

### 4.3 `slurm/slurm.conf` 主要設定

```
ClusterName=conoha
SlurmctldHost=slurm
AuthType=auth/munge
AuthAltTypes=auth/jwt
AuthAltParameters=jwt_key=/var/spool/slurm/jwt_hs256.key

AccountingStorageType=accounting_storage/slurmdbd
AccountingStorageHost=slurmdbd
AccountingStoragePort=6819

JobAcctGatherType=jobacct_gather/linux

NodeName=slurm CPUs=2 RealMemory=1024 State=UNKNOWN
PartitionName=debug Nodes=slurm Default=YES MaxTime=INFINITE State=UP
```

`CPUs=2` と `RealMemory=1024` は `g2l-t-2` (2GB / 3 vCPU) を想定。README で「より大きい VM を使うときは値を上げる」と注記。

### 4.4 `slurmdbd` コンテナ

slurm イメージを再利用し、`entrypoint.sh` を分岐 (環境変数 `ROLE=slurmdbd`)。munge を起動した上で `slurmdbd -D` を起動。`/etc/slurm/slurmdbd.conf` のみ slurmdbd-side テンプレートを上書き。

`slurmdbd.conf` 主要設定：

```
StorageType=accounting_storage/mysql
StorageHost=mariadb
StoragePort=3306
StorageUser=slurm
StoragePass=${SLURM_DB_PASSWORD}
StorageLoc=slurm_acct_db
```

### 4.5 `mariadb` accessory

公式 `mariadb:11` イメージ。

環境変数：

- `MARIADB_DATABASE=slurm_acct_db`
- `MARIADB_USER=slurm`
- `MARIADB_PASSWORD=${SLURM_DB_PASSWORD}` (compose の `.env` で生成)
- `MARIADB_ROOT_PASSWORD=${MARIADB_ROOT_PASSWORD}`

ヘルスチェック: `mysqladmin ping -h localhost`

データ永続化: 名前付きボリューム `mariadb-data`。

### 4.6 ボリューム

| ボリューム | マウント先 | 共有範囲 |
|------------|------------|----------|
| `munge-key` | `/etc/munge` | slurm + slurmdbd |
| `slurm-spool` | `/var/spool/slurm` | slurm (JWT 鍵もここ) |
| `slurm-log` | `/var/log/slurm` | slurm + slurmdbd |
| `mariadb-data` | `/var/lib/mysql` | mariadb |
| `work` | `/work` | slurm (ジョブの結果・出力ファイル置き場) |

## 5. conoha.yml

```yaml
name: slurm-rest-api
hosts:
  - slurm.example.com
web:
  service: slurm
  port: 6820
  blue_green: false
health:
  path: /openapi/v3
  unhealthy_threshold: 24    # 24 × 5s = 120s, カバーする起動: munge → slurmdbd → mariadb → slurmctld → slurmrestd
accessories:
  - slurmdbd
  - mariadb
```

`/openapi/v3` は slurmrestd が無認証で提供する OpenAPI 定義エンドポイント。200 が返れば「全体が起動完了」を意味する。

## 6. 認証フロー (JWT)

### 6.1 鍵管理

- HS256 共有鍵 (`/var/spool/slurm/jwt_hs256.key`) は slurm コンテナ内でのみ生成 / 保持。ホスト側にもエクスポートしない。
- slurmctld がトークンを発行し、slurmrestd が同じ鍵で検証 (同一コンテナ内なので同じファイルを参照)。

### 6.2 トークン取得 (`examples/get-token.sh`)

```bash
#!/usr/bin/env bash
# 使い方:
#   conoha server ssh myserver -- ./examples/get-token.sh <username> <lifespan_sec>
# デフォルト:
#   username = slurm
#   lifespan = 86400 (1 日)
set -euo pipefail
USER="${1:-slurm}"
LIFESPAN="${2:-86400}"
TOKEN=$(docker exec -u slurm $(docker ps -qf name=slurm-rest-api_slurm) \
  scontrol token username="${USER}" lifespan="${LIFESPAN}" \
  | awk -F= '{print $2}')
echo "${TOKEN}"
```

クライアント側の使用：

```bash
conoha server ssh myserver -- ./examples/get-token.sh slurm 86400 > ~/.slurm-api/token
echo 'https://slurm.example.com' > ~/.slurm-api/endpoint
```

### 6.3 リクエストヘッダ

```
Authorization: Bearer <JWT>
X-SLURM-USER-NAME: slurm
```

`X-SLURM-USER-NAME` は slurmrestd の仕様上必須 (JWT の `sun` クレームと一致させる)。

## 7. Python CLI (`examples/cli/slurm_cli.py`)

### 7.1 依存

`requirements.txt`:

```
click>=8.1
requests>=2.32
```

### 7.2 設定の優先順位

1. CLI フラグ (`--endpoint`, `--token`, `--user`)
2. 環境変数 (`SLURM_API_ENDPOINT`, `SLURM_API_TOKEN`, `SLURM_API_USER`)
3. ファイル (`~/.slurm-api/endpoint`, `~/.slurm-api/token`, ユーザーは `slurm` 固定)

### 7.3 サブコマンド

| コマンド | エンドポイント | 説明 |
|----------|---------------|------|
| `slurm-cli nodes` | `GET /slurm/v0.0.40/nodes` | ノード一覧と状態 (idle/alloc/mix) |
| `slurm-cli submit <script.py> [--cpus N] [--mem MB] [--time HH:MM:SS] [--array RANGE] [--name NAME]` | `POST /slurm/v0.0.40/job/submit` | Python スクリプトを `#!/bin/bash\npython3 <abs path>` でラップして submit |
| `slurm-cli status [job_id]` | `GET /slurm/v0.0.40/jobs[/{id}]` | 状態取得 (job_id 省略時はキュー全体) |
| `slurm-cli logs <job_id>` | (SSH + `scontrol show job`) | stdout ファイルパスを取得して cat |
| `slurm-cli cancel <job_id>` | `DELETE /slurm/v0.0.40/job/{id}` | ジョブ取消 |
| `slurm-cli history [--limit N]` | `GET /slurmdb/v0.0.40/jobs?...` | slurmdbd 経由の完了ジョブ履歴 |

### 7.4 submit のペイロード形

```json
{
  "job": {
    "name": "numpy_matmul",
    "partition": "debug",
    "cpus_per_task": 4,
    "memory_per_node": 1024,
    "time_limit": 60,
    "current_working_directory": "/work",
    "standard_output": "/work/logs/%j.out",
    "standard_error": "/work/logs/%j.err",
    "environment": ["PATH=/usr/bin:/bin"],
    "array": "0-4"
  },
  "script": "#!/bin/bash\npython3 /work/scripts/numpy_matmul.py"
}
```

スクリプトファイルは `submit` 時に `slurm-cli` がローカルファイルを読み、`scp` ではなく **slurmrestd 経由でスクリプト本文を inline 送信** する (slurmrestd が `script` フィールドを受け取れる)。スクリプトが参照する Python ファイル本体は `/work/scripts/` に置く必要があるため、submit 前に `slurm-cli` が SSH 経由で `docker cp <local> <container>:/work/scripts/` を実行する。

→ この "SSH + docker cp" がやや煩雑なので、簡易版として **小さい Python スクリプトは `submit --inline` で全部 `script:` 本文に埋め込む** モードも用意する。`numpy_matmul.py` / `hyperparam_sweep.py` はインライン対応。

## 8. ワークロード例 (`examples/workloads/`)

### 8.1 `numpy_matmul.py`

```python
import os, time
import numpy as np

N = int(os.environ.get("MATMUL_N", "4096"))
ROUNDS = int(os.environ.get("MATMUL_ROUNDS", "5"))

a = np.random.rand(N, N).astype(np.float32)
b = np.random.rand(N, N).astype(np.float32)

t0 = time.perf_counter()
for _ in range(ROUNDS):
    c = a @ b
elapsed = time.perf_counter() - t0
print(f"N={N} rounds={ROUNDS} elapsed={elapsed:.3f}s "
      f"gflops={(2 * N**3 * ROUNDS) / elapsed / 1e9:.2f}")
```

`slurm-cli submit numpy_matmul.py --cpus 2 --inline` で実行。`--cpus` を 1 → 2 と変えて GFLOPS の変化を確認できる (NumPy が OpenBLAS 経由でスレッドを使うため)。

### 8.2 `hyperparam_sweep.py` (配列ジョブ)

```python
import os, json
from sklearn.datasets import load_iris
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score

PARAMS = [10, 50, 100, 200, 500]
idx = int(os.environ["SLURM_ARRAY_TASK_ID"])
n_estimators = PARAMS[idx]

X, y = load_iris(return_X_y=True)
clf = RandomForestClassifier(n_estimators=n_estimators, random_state=42)
scores = cross_val_score(clf, X, y, cv=5)

result = {"n_estimators": n_estimators, "mean_acc": float(scores.mean()),
          "std": float(scores.std())}
print(json.dumps(result))

os.makedirs("/work/results", exist_ok=True)
with open(f"/work/results/sweep_{idx}.json", "w") as f:
    json.dump(result, f)
```

`slurm-cli submit hyperparam_sweep.py --array 0-4 --inline` → 5 つのタスクが並列実行。完了後 `/work/results/` を集計するヘルパースクリプト `examples/workloads/collect_sweep.py` で表示。

## 9. テスト (`tests/smoke_test.py`)

CI には登録しない (他のサンプルと同様、デプロイ後の手動検証用)。検証項目：

1. `GET /openapi/v3` が 200
2. `GET /slurm/v0.0.40/nodes` でノード 1 件、`state` に `IDLE` が含まれる
3. `POST .../job/submit` で `echo hello smoke` を submit、`job_id` を取得
4. 30 秒間 1 秒間隔でポーリングし、状態が `COMPLETED` に遷移するのを確認
5. `GET /slurmdb/v0.0.40/jobs?job_name=smoke` で当該ジョブがアカウンティング DB に記録されている

実行方法は README に記載 (`SLURM_API_ENDPOINT` と `SLURM_API_TOKEN` を env で渡す)。

## 10. ヘルスチェック / 依存

compose レベル：

- `mariadb`: `healthcheck: mysqladmin ping`
- `slurmdbd`: `depends_on: { mariadb: { condition: service_healthy } }`, `healthcheck: nc -z localhost 6819`
- `slurm`: `depends_on: { slurmdbd: { condition: service_healthy } }`

conoha.yml レベル：

- `health.path: /openapi/v3`、`unhealthy_threshold: 24` (= 120s)

## 11. トラブルシューティング (README に掲載)

| 症状 | 原因 | 対処 |
|------|------|------|
| `slurmctld` が落ちる、ログに `Munge decode failed` | munge 鍵不一致 (例: slurmdbd 側だけ古い鍵) | `docker compose down -v` でボリュームを全削除して再起動 |
| API が `401 Unauthorized` | JWT トークン期限切れ | `get-token.sh` を再実行して `~/.slurm-api/token` を更新 |
| ジョブが永遠に `PENDING (Resources)` | `slurm.conf` の `CPUs=` が VM 物理コア超過 | `CPUs=` を VM コア数以下に下げる、または大きいフレーバーに移行 |
| `slurmdbd` 起動失敗、ログに `mysql connect` エラー | `slurmdbd.conf` の `StoragePass` と `mariadb` の `MARIADB_PASSWORD` 不一致 | `.env` で同じ値を使うことを確認 |
| `slurmrestd` 起動失敗、`AuthAltTypes` エラー | JWT 鍵ファイルのパーミッション (0600 / owner slurm) が崩れている | コンテナ内で `chmod 0600 /var/spool/slurm/jwt_hs256.key && chown slurm:slurm ...` |

## 12. Out of Scope (このサンプルでは扱わない)

- マルチユーザー (PAM / LDAP 連携、ユーザーごとの uid/gid 隔離)
- 自動 JWT リフレッシュ
- GPU スケジューリング (`Gres=gpu` 設定)
- ジョブごとのコンテナ隔離 (`pyxis` / `singularity` 等)
- HA controller (backup slurmctld + slurmctld_primary_on_backup)
- `sshare` / `sreport` 等のアカウンティングレポート UI
- マルチノード (ConoHa VPS3 で疑似マルチノードを組むには別の VM が必要 — 本サンプルの範囲外)

README に「本サンプルはデモ用。プロダクションでは少なくともマルチユーザー・短寿命 JWT + 自動更新・ジョブ隔離が必要」と注記。

## 13. README 表への追加行

```
| [slurm-rest-api](slurm-rest-api/) | Slurm + slurmrestd + slurmdbd + MariaDB | Slurm 単一ノードクラスター + REST API (JWT, Python CLI + NumPy/ML ワークロード) | g2l-t-2 (2GB) |
```

## 14. 実装後の動作確認シナリオ (README "Quick start")

```bash
# 1. サーバー作成 (既存 VM があれば省略)
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. proxy 起動 (初回のみ)
conoha proxy boot --acme-email you@example.com myserver

# 3. conoha.yml の hosts: を自分の FQDN に書き換え

# 4. デプロイ
cd slurm-rest-api
conoha app init myserver
conoha app deploy myserver

# 5. JWT トークン取得
mkdir -p ~/.slurm-api
echo "https://slurm.example.com" > ~/.slurm-api/endpoint
conoha server ssh myserver -- ./examples/get-token.sh slurm 86400 \
  > ~/.slurm-api/token

# 6. CLI セットアップ
cd examples/cli && pip install -r requirements.txt

# 7. 動作確認
./slurm_cli.py nodes
./slurm_cli.py submit ../workloads/numpy_matmul.py --cpus 2 --inline
./slurm_cli.py status
./slurm_cli.py logs <job_id>

# 8. 配列ジョブ
./slurm_cli.py submit ../workloads/hyperparam_sweep.py --array 0-4 --inline
./slurm_cli.py history --limit 10
```
