---
title: conoha-cli で Slurm の REST API + JWT 認証環境を ConoHa VPS3 に立てる — Python から `submit/array job` まで
tags: ConoHa conoha-cli Slurm HPC Docker
author: crowdy
slide: false
---

## はじめに

「Slurm を触ってみたい」と思ったとき、いきなり物理ノード 2 台用意して `slurm-wlm` を組むのは重いです。ジョブスケジューラ自体の挙動を確かめたいだけだったり、`slurmrestd` の REST API を Python から叩いてみたいだけのこともよくあります。

そこで、ConoHa VPS3 1 台に Slurm クラスター（controller + worker + accounting DB）と REST API を **`conoha app deploy` 一発で立てる** サンプルを書きました。`conoha-cli-app-samples` シリーズの新作です。

- 単一 VPS で **controller / worker / accounting / REST API / DB** が立ち上がる
- HTTPS の REST API が **JWT 認証付き** で外から叩ける（Let's Encrypt 自動取得）
- 同梱の **Python CLI** で `nodes / status / submit / cancel / history` がそのまま使える
- **NumPy / scikit-learn のワークロード例** と **配列ジョブ** で `sbatch` 相当の挙動を再現できる

サンプル一式: [crowdy/conoha-cli-app-samples — slurm-rest-api](https://github.com/crowdy/conoha-cli-app-samples/tree/main/slurm-rest-api)

---

## 想定読者

- Slurm の REST API 部分（`slurmrestd`）を Python から叩く環境を、最小手数で用意したい方
- 配列ジョブやアカウンティング DB を含む「ひと通り動く Slurm クラスター」を VPS でサクッと欲しい方
- ConoHa VPS3 + `conoha app deploy` の web + accessories 構成にサンプルを 1 個増やしたい方

---

## 構成

```
                 HTTPS (conoha-proxy + Let's Encrypt)
                              │
                              ▼
                   ┌──────────────────────┐
                   │ slurm-edge (caddy)   │  ← web slot
                   │   /healthz → 200     │
                   │   /*      → slurmrestd│
                   └──────────┬───────────┘
                              │ docker network
                              ▼
        ┌─────────────────────────────────────────────┐   accessories
        │                                             │
        │  slurmrestd ←── munge + JWT ──── slurmctld │
        │                                       │     │
        │                                       ▼     │
        │                                   cpu-worker│
        │                                       │     │
        │  slurmdbd ←─── munge ─────────────────┘     │
        │      │                                       │
        │      ▼                                       │
        │  mariadb:12                                  │
        │                                             │
        └─────────────────────────────────────────────┘
```

| 役割 | サービス | 補足 |
|------|----------|------|
| Slurm controller | `slurmctld` | ジョブ受付・スケジューリング |
| Slurm worker | `cpu-worker` (`slurmd -Z`) | ジョブ実行 |
| Accounting daemon | `slurmdbd` | `history` / array job 管理 |
| REST API | `slurmrestd` | JWT 認証付き API |
| DB | `mariadb:12` | `slurm_acct_db` 永続化 |
| 公開エッジ | `slurm-edge` (Caddy) | proxy 用 `/healthz` + reverse_proxy |

ベースイメージは [`giovtorres/slurm-docker-cluster:25.11.4`](https://github.com/giovtorres/slurm-docker-cluster)（Rocky Linux 9 + Slurm 25.11、`--with-jwt` ビルド済み）の薄いラッパーで、ワークロード用に `numpy` と `scikit-learn` を足しています。

---

## Quick start

ConoHa VPS3 アカウント・`conoha-cli` 設定済み・SSH キー登録済み前提です。所要時間は **5 分弱**（ACME 証明書取得込み）。

```bash
# 1. VPS 作成（g2l-t-2: 3 vCPU / 2 GB、Docker pre-installed VMI）
conoha server create \
  --name myslurm \
  --flavor g2l-t-c3m2 \
  --image vmi-docker-29.2-ubuntu-24.04-amd64 \
  --key-name your-key \
  --security-group default --security-group IPv4v6-SSH --security-group IPv4v6-Web \
  --wait

# 2. DNS を VPS の IP に向けた FQDN を用意（手早く済ませるなら sslip.io が便利）

# 3. プロキシ起動（VPS ごと 1 回）
conoha proxy boot --acme-email you@example.com myslurm

# 4. サンプルを clone してデプロイ
git clone https://github.com/crowdy/conoha-cli-app-samples
cd conoha-cli-app-samples/slurm-rest-api
cp .env.example .env  # 2 つのパスワードを編集
sed -i 's|slurm.example.com|your-fqdn|' conoha.yml
conoha app init myslurm --app-name slurm-rest-api
conoha app deploy myslurm
```

`Deploy complete. phase=live` が出れば、6 つのコンテナ（web slot の `slurm-edge` + accessories 5 つ）が立ち上がっています。HTTPS の health probe を確認:

```bash
$ curl -s -o /dev/null -w '%{http_code}\n' https://your-fqdn/healthz
200
```

---

## JWT トークン取得 → Python CLI でジョブ投入

`slurmctld` コンテナで `scontrol token` を叩いて JWT を取り出します（同梱の `get-token.sh` がこの一手間を包んでくれます）:

```bash
mkdir -p ~/.slurm-api
echo "https://your-fqdn" > ~/.slurm-api/endpoint
conoha server ssh myslurm -- ./examples/get-token.sh slurm 86400 \
    > ~/.slurm-api/token
```

CLI の依存を入れて試します:

```bash
cd examples/cli
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

$ ./slurm_cli.py nodes
c1               state=IDLE,DYNAMIC_NORM cpus=3 mem=1966MB

$ ./slurm_cli.py submit ../workloads/numpy_matmul.py --cpus 2 --mem 512 --inline
submitted job_id=2 name=numpy_matmul

$ ./slurm_cli.py submit ../workloads/hyperparam_sweep.py --array 0-4 --inline
submitted job_id=3 name=hyperparam_sweep

$ ./slurm_cli.py history --limit 10
1   COMPLETED  smoke              ...
2   COMPLETED  numpy_matmul       ...   # 188 GFLOPS @ N=2048
3-7 COMPLETED  hyperparam_sweep   ...   # array tasks 0-4 すべて完了
```

`submit` は対象 Python ファイルを heredoc でラップして `slurmrestd /job/submit` に POST する仕組みなので、`docker cp` で事前にスクリプトを送り込む必要がありません。`--array` をつければ配列ジョブもそのまま投げられます。`history` は `slurmdbd` の accounting レコードを読みに行きます。

ヘッダは `X-SLURM-USER-NAME` + `X-SLURM-USER-TOKEN` の 2 つだけ。`Authorization: Bearer` は **意図的に送りません**（slurmrestd の rest_auth/jwt は両方ヘッダを併送すると弾きます）。

---

## ワークロード例 2 種

### `numpy_matmul.py` — 単発ジョブ

NumPy で 2048×2048 の行列積を 3 回回して GFLOPS を出します:

```python
N = int(os.environ.get("MATMUL_N", "2048"))
ROUNDS = int(os.environ.get("MATMUL_ROUNDS", "3"))
a = np.random.rand(N, N).astype(np.float32)
b = np.random.rand(N, N).astype(np.float32)
t0 = time.perf_counter()
for _ in range(ROUNDS):
    c = a @ b
elapsed = time.perf_counter() - t0
print(f"elapsed={elapsed:.3f}s gflops={(2*N**3*ROUNDS)/elapsed/1e9:.2f}")
```

`g2l-t-c3m2` で **188 GFLOPS** 程度。`--cpus 2` ↔ `--cpus 1` で BLAS のマルチスレッド効果も観測できます。

### `hyperparam_sweep.py` — 配列ジョブ

scikit-learn の `RandomForestClassifier` を `n_estimators ∈ {10, 50, 100, 200, 500}` でスイープし、各タスクが自分の結果を `/tmp/sweep_<idx>.json` に書きます:

```python
PARAMS = [10, 50, 100, 200, 500]
idx = int(os.environ["SLURM_ARRAY_TASK_ID"])
n_estimators = PARAMS[idx]
X, y = load_iris(return_X_y=True)
clf = RandomForestClassifier(n_estimators=n_estimators, random_state=42)
scores = cross_val_score(clf, X, y, cv=5)
# ... result を /tmp/sweep_<idx>.json に書き出し
```

`slurm_cli.py submit ... --array 0-4` で 5 タスクが並列実行。完了後に同梱の `collect_sweep.py` で集約します:

```
task  n_estimators  mean_acc    std       
0     10            0.9667      0.0211    
1     50            0.9667      0.0211    
2     100           0.9667      0.0211    
3     200           0.9667      0.0211    
4     500           0.9667      0.0211    
```

`SLURM_ARRAY_TASK_ID` 環境変数の伝播・配列ジョブの完了検知・accounting DB への記録までひと通り確認できます。

---

## API エンドポイント早見表

`slurmrestd` v0.0.42 のうち、本サンプルで使うエンドポイント:

| Path | 用途 |
|------|------|
| `GET  /healthz` | conoha-proxy 健全性プローブ（Caddy が 200 を返す、認証なし） |
| `GET  /openapi/v3` | OpenAPI スキーマ（JWT 必須） |
| `GET  /slurm/v0.0.42/nodes/` | ノード一覧 |
| `GET  /slurm/v0.0.42/jobs/` | ジョブキュー |
| `GET  /slurm/v0.0.42/job/{id}` | 個別ジョブ |
| `POST /slurm/v0.0.42/job/submit` | ジョブ投入 |
| `DELETE /slurm/v0.0.42/job/{id}` | キャンセル |
| `GET  /slurmdb/v0.0.42/jobs/` | 完了済みジョブ（accounting） |

トークン付きでスキーマを取れば Swagger UI / Insomnia / Bruno でも探索できます:

```bash
curl -H "X-SLURM-USER-NAME: slurm" \
     -H "X-SLURM-USER-TOKEN: $(cat ~/.slurm-api/token)" \
     https://your-fqdn/openapi/v3 | jq
```

---

## 構成上のキー判断

このサンプルで「すんなり立たせる」ために手間を入れた部分を 4 点だけ:

### 1. ベースイメージは Rocky 9 系のコミュニティイメージ

最初は Ubuntu 24.04 + `slurm-wlm` で組もうとしました。ところが **Ubuntu の `slurm-wlm` パッケージは `slurmrestd` 側の `rest_auth/jwt.so` だけビルドされていて、`slurmctld` 側の `auth/jwt.so` を含んでいません**。

```bash
$ ls /usr/lib/x86_64-linux-gnu/slurm-wlm/ | grep -iE "auth"
auth_munge.so
auth_none.so
auth_slurm.so
rest_auth_jwt.so       # ← REST 側はある
                       # ↑ auth_jwt.so がない → JWT 発行・検証ができない
```

`slurmctld` が `cannot create auth context for auth/jwt` で fatal exit します。`apt-cache search slurm.*jwt` で別パッケージも出てきません。

JWT を有効にしたい場合の現実的な選択肢は (a) Rocky/RHEL 系の RPM、(b) ソースから `--with-jwt` でビルド、(c) JWT 入りビルド済みイメージ、のどれかです。今回は (c) の [`giovtorres/slurm-docker-cluster`](https://github.com/giovtorres/slurm-docker-cluster) を採用しました。Slurm 25.11.x と 25.05.x をサポートし、現在も active に更新されています。

### 2. `slurmrestd` は web ではなく accessories に置く

`conoha app deploy` は **web slot を `<app>-<slot>`、accessories を `<app>-accessories` という別々の compose project で起動します**。compose の named volume は project 内でスコープされるので、`etc_munge` や `etc_slurm`（JWT 鍵もここ）を slurmrestd と slurmctld で共有したければ、両方を accessories に置く必要があります。

slurmrestd を web に置いた最初の構成では、slurmrestd が空の `/etc/munge` で立ち上がって全 RPC が `MUNGE_ERR_BAD_CRED`、JWT 鍵も無いので全リクエスト 401、という詰みパターンを踏みました。

### 3. web には Caddy の薄いサイドカーだけ

`slurmrestd` は `/openapi/v3` も含めて全エンドポイントが JWT 必須なので、conoha-proxy の **strict 2xx な health probe（認証ヘッダなし）が永遠に通りません**。

リポジトリ内の `quickwit-otel` サンプルが同じ問題を Caddy のサイドカーで解いていたので、その構成を踏襲しました。`Caddyfile` はたった 10 行:

```caddy
:6820 {
    @probe path /healthz
    handle @probe {
        respond "ok" 200
    }
    reverse_proxy slurmrestd:6820
}
```

これで proxy が叩く `/healthz` は無認証で 200、他のパスは JWT 付きで slurmrestd に素通しできます。

### 4. cpu-worker の名前と `COMPOSE_PROJECT_NAME` 注入

`giovtorres` イメージの entrypoint は `slurmd-cpu` モードで起動するときに **`${COMPOSE_PROJECT_NAME}-cpu-worker-<N>` というホスト名を Docker DNS に問い合わせて自分の replica 番号を割り出します**。

- compose の **service 名を `cpu-worker`** にする必要がある（`slurmd` だと DNS lookup が空振りして entrypoint が黙って exit）
- **`COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}`** を env に明示する必要がある（compose は YAML 解釈時には `-p` 値を見るが、コンテナの env にはデフォルトでは流さない）

```yaml
cpu-worker:
  image: *slurm-image
  command: ["slurmd-cpu"]
  privileged: true
  environment:
    - COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}
```

---

## まとめ

最終的に手に入ったもの:

| 機能 | 状況 |
|------|------|
| Single-VPS Slurm cluster（controller + worker + accounting + DB） | `conoha app deploy` 1 発で立つ |
| HTTPS の slurmrestd REST API | Let's Encrypt 自動取得、JWT 認証付き |
| Python CLI（`nodes/status/submit/cancel/history/logs`） | `pip install -r requirements.txt` で動く |
| 単発ジョブ + 配列ジョブのワークロード例 | NumPy 行列積 + sklearn ハイパラスイープ |
| smoke test | 5 項目（health / nodes / submit / completion / accounting）が exit 0 |

`docker compose up` をローカルで動かして見ているだけだと、`conoha app deploy` 経由で初めて顕在化する制約（web/accessories の compose project 分離、named volume の scope、proxy の health probe 仕様）に気付きづらいです。**「ローカルで通った」と「`conoha app deploy` で通った」を別物として 2 段階で検証する** のが、今回一番効きました。

Slurm の REST API を素振りしたい・配列ジョブを Python から書きたい・accounting DB の挙動を見たい、というニーズに対しては、VPS 1 台で 5 分で揃う環境が出来上がりました。試してみたら GitHub の issue / PR でフィードバックいただけるとうれしいです。

### 参考

- [crowdy/conoha-cli-app-samples — slurm-rest-api サンプル](https://github.com/crowdy/conoha-cli-app-samples/tree/main/slurm-rest-api)
- [PR #99 — feat(slurm-rest-api): add single-node Slurm + REST API sample](https://github.com/crowdy/conoha-cli-app-samples/pull/99)
- [PR #101 — fix(slurm-rest-api): switch to giovtorres + caddy sidecar](https://github.com/crowdy/conoha-cli-app-samples/pull/101)
- [giovtorres/slurm-docker-cluster](https://github.com/giovtorres/slurm-docker-cluster) — JWT 入りの maintained Slurm Docker image
- [Slurm Workload Manager — JWT Authentication](https://slurm.schedmd.com/jwt.html)
- [Slurm Workload Manager — Containers Guide](https://slurm.schedmd.com/containers.html)
- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)
