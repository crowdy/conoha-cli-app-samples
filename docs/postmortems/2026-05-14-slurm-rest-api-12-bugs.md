# `slurm-rest-api` — 実機検証で見つけた 12 件のバグと、その対応

- **対象サンプル**: `slurm-rest-api/`
- **関連 PR**: [#99](https://github.com/crowdy/conoha-cli-app-samples/pull/99), [#101](https://github.com/crowdy/conoha-cli-app-samples/pull/101)
- **検証期間**: 2026-05-13 〜 2026-05-14
- **目的**: 同種サンプルを新規に書く / レビューする際の参照資料

このドキュメントは「サンプルが手元で動くまでに踏んだ落とし穴の網羅リスト」です。Qiita 公開記事は使い方中心にリフレーミングしましたが、こちらの内訳は別のサンプルを書くときに直接時間を節約できる資産になるはずなので、リポジトリ内資料として残します。

---

## 概要

`slurm-rest-api` サンプルは 2 本の PR と 3 回の VPS 実機検証を経てマージされました。発見されたサンプル側のバグは合計 **12 件**。検証経路で見つかったもの・コード見直しで見つかったものが混在しています。

| Phase | アプローチ | 検証方法 | 結果 |
|-------|----------|---------|------|
| PR #99 直前 | Ubuntu 24.04 + `slurm-wlm` で all-in-one コンテナ | コードを通しで見直し | C1: PID ファイル / C2: slurmrestd plugin 指定 など 2 件発見、merge |
| PR #99 マージ後 | 実 VPS smoke test (`docker compose up`) | g2l-t-c3m2 で `docker compose up -d` | **Ubuntu `slurm-wlm` には `auth/jwt` プラグインが入っていない** ことが判明 |
| PR #101 初版 | `giovtorres/slurm-docker-cluster` に乗り換え | 同上、`docker compose up -d` で 5/5 PASS | この時点では「smoke test 通った」と思っていた |
| PR #101 改めて見直し | conoha-cli ソースまで読みに行って Critical 再探索 | コード照合 | **C1-C4 すべて発見**: smoke test は `conoha app deploy` 経路を全くカバーしていなかった |
| PR #101 修正後 | Caddy サイドカーで再構造、実 VPS で `conoha app deploy` | g2l-t-c3m2 + sslip.io + Let's Encrypt | 5/5 PASS、workload e2e も 7/7 COMPLETED |

つまり同じ「smoke test 通った」が **`docker compose up` 経由か `conoha app deploy` 経由か** で意味が全く違いました。それに最後に気付けたのは、コード側を改めて conoha-cli のソースまで遡って見直したからです。

---

## Phase 1 — Ubuntu ベースで踏んだ落とし穴

### Phase 1-A: PR #99 のコード見直しで先に潰した 2 件

| # | 内容 | 場所 | 修正コミット |
|---|------|------|-------------|
| 1 | `SlurmctldPidFile=/var/run/...` を `slurm` ユーザーで書こうとしてEACCES、起動不能 | `slurm/slurm.conf` | `0e5c5a9` PID ファイルを `/var/spool/slurm/` 配下に |
| 2 | `slurmrestd` をプラグイン未指定で起動すると `slurmdb` ルートが登録されず、`history` / smoke step 5 が動かない | `slurm/entrypoint.sh` | `2968b11` `-s slurmctld,slurmdbd,openapi/v0.0.40` 明示 |

### Phase 1-B: 実 VPS で起動して初めて見えた致命

**Ubuntu / Debian の `slurm-wlm` パッケージは `slurmrestd` 側の `rest_auth/jwt.so` だけビルドされていて、`slurmctld` 側の `auth/jwt.so` を含んでいません。**

```bash
$ ls /usr/lib/x86_64-linux-gnu/slurm-wlm/ | grep -iE "auth"
auth_munge.so
auth_none.so
auth_slurm.so
rest_auth_jwt.so       # ← slurmrestd 側
                       # ↑ auth_jwt.so が欠落 → JWT 発行・検証が成立しない
```

`slurmctld` のログ:

```
slurmctld: error: Couldn't find the specified plugin name for auth/jwt looking at all files
slurmctld: error: cannot find auth plugin for auth/jwt
slurmctld: error: cannot create auth context for auth/jwt
slurmctld: fatal: failed to initialize auth plugin
```

`apt-cache search slurm.*jwt` でも別パッケージはありません。これは知らないと丸 1 日溶かす設計レベルの制約です。コードレビューで見抜くのはほぼ不可能で、実機で `slurmctld` を立ち上げて初めて出ます。

選択肢:

| 案 | 評価 |
|---|------|
| A. Rocky Linux + EPEL から slurm を入れる | RHEL 系で JWT 入りビルド可。検証コスト中 |
| B. ソースから `./configure --with-jwt` でビルド | 5-10 分のビルド時間。Dockerfile が複雑化 |
| C. JWT 入りのコミュニティイメージを使う | [`giovtorres/slurm-docker-cluster`](https://github.com/giovtorres/slurm-docker-cluster) が Rocky 9 + Slurm 25.11 + JWT |
| D. JWT を諦めて munge だけにする | `slurmrestd` を HTTPS で外に出す動機がなくなる |

C を採用しました。

---

## Phase 2 — giovtorres イメージへの乗り換えで踏んだ 9 件

| # | 内容 | 修正 |
|---|------|------|
| 3 | `mariadb:11` healthcheck が `mysqladmin` を呼んでいる（MariaDB 11 系で削除済み、`mariadb-admin` だけ残る） | healthcheck の bin 名を変更 |
| 4 | compose の `hostname:` 未指定で `DbdHost=slurmdbd` / `SlurmctldHost=slurmctld` がコンテナ ID にマッチせず `fatal: This host not configured to run SlurmDBD` | 各 service に `hostname:` 明示 |
| 5 | `slurmd` / `slurmrestd` が `unshare()` で `Operation not permitted` → 起動不能 | `privileged: true` 明示（giovtorres の supported 構成） |
| 6 | giovtorres entrypoint が `${COMPOSE_PROJECT_NAME}-cpu-worker-<N>` を DNS lookup → 戻り値が空 → `set -e` で entrypoint silent exit | service 名を `cpu-worker` に変更 |
| 7 | `COMPOSE_PROJECT_NAME` がコンテナ env に流れない（compose は YAML 解釈時にしか `-p` 値を見ない） | `environment: - COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}` |
| 8 | API パスとパーティション名がイメージ依存（v0.0.40 → 41-44、`debug` → `cpu`、コレクション末尾スラッシュ必須） | `http.py` / `smoke_test.py` / `payload.py` のデフォルト変更 |
| 9 | `Authorization: Bearer` を併送すると rest_auth/jwt が 401 を返す | `X-SLURM-USER-TOKEN` のみ送る |
| 10 | `/data`（`slurm_jobdir` ボリューム）が root 所有のため、`slurm` ユーザーで走るジョブが `/data/logs/%j.out` を書けず FAILED | stdout/stderr を `/tmp` に逃がす |
| 11 | numpy / sklearn がベースイメージにない、しかも `python3` (3.12) に `pip` 同梱なし | `python3 -m ensurepip --upgrade` → `pip install numpy~=2.4 scikit-learn~=1.8` |

### 6 番のディテール — 一番デバッグに時間を取られた

giovtorres の entrypoint の該当箇所:

```bash
detect_replica_number() {
    local service_name="$1"
    local my_ip
    my_ip=$(hostname -i 2>/dev/null | awk '{print $1}')
    for i in $(seq 1 "${2:-64}"); do
        local resolved
        resolved=$(getent hosts "${COMPOSE_PROJECT_NAME}-${service_name}-${i}" 2>/dev/null | awk '{print $1}')
        if [ "$resolved" = "$my_ip" ]; then
            echo "$i"
            return 0
        elif [ -z "$resolved" ]; then
            break
        fi
    done
    hostname
    return 1
}

# 呼び出し側:
REPLICA=$(detect_replica_number "cpu-worker")
```

`set -e` 下で `$(...)` の戻りが非ゼロだと親が終了します。fallback パスは `return 1` で抜けるので、DNS 名 `<project>-cpu-worker-1` が引けない限り entrypoint が「`slurmctld is now active` を出した直後に何もログ残さず exit」します。サンプル側の compose service 名と env を **2 件同時に** 整えないと再現しない、典型的なサイレント failure です。

---

## Phase 3 — `conoha app deploy` 経路の致命 4 件（コード見直しで発見）

`docker compose up` で smoke test が通った PR #101 初版を「Ubuntu の JWT 抜けを見抜けなかった反省を踏まえて、関連リポジトリのソースまで読みに行って再点検する」方針で見直したところ、4 つの Critical が出ました。

### C1. `COMPOSE_PROJECT_NAME=slurm-rest-api` のハードコードが効かない

`conoha-cli/cmd/app/override.go`:

```go
func slotProjectName(app, slot string) string {
    return fmt.Sprintf("%s-%s", app, slot)
}
func accessoryProjectName(app string) string {
    return app + "-accessories"
}
```

実際の `conoha app deploy` は `slurm-rest-api-9de690b` (web slot) と `slurm-rest-api-accessories` (accessories) という 2 つの compose project 名になります。Phase 2 で潰したつもりだった「`COMPOSE_PROJECT_NAME` 注入」も値がリテラル `slurm-rest-api` だと意味がなく、cpu-worker の replica 検出は再び空振り。

**修正**: `${COMPOSE_PROJECT_NAME}` を YAML 内で展開させる。compose は `-p` 値で interpolation するので、deploy 時の実 project 名がそのまま入る。

### C2. compose の named volume は project をまたいで共有できない

`etc_munge` / `etc_slurm` / `var_log_slurm` を web (slurmrestd) と accessories (slurmctld など) で共有する設計でしたが、**named volume は project 内でスコープされます**。web slot の `slurm-rest-api-9de690b_etc_munge` と accessories の `slurm-rest-api-accessories_etc_munge` は別物。

その結果、web 側に置いた slurmrestd は:
- 空の `/etc/munge` で起動 → 全 RPC が `MUNGE_ERR_BAD_CRED`
- 空の `/etc/slurm` で起動 → JWT 鍵がない → 全リクエスト 401

**修正**: slurmrestd を `accessories:` に移して、他の Slurm 系と同じ project に置く。`web:` には別物（後述の Caddy サイドカー）を立てる。

### C3. conoha-proxy の health probe は strict 2xx

`conoha-proxy/internal/health/health.go:53`:

```go
if resp.StatusCode >= 200 && resp.StatusCode < 300 {
```

slurmrestd は `/openapi/v3` も含めて全エンドポイントが JWT 必須なので、認証ヘッダのない probe は永遠に 401。deploy が 120 秒で health timeout を起こします。

**修正**: 「Caddy サイドカーパターン」を導入。`web:` を `slurm-edge` という Caddy のみのコンテナにし、`/healthz` を unauth で 200 返し、それ以外を `slurmrestd:6820` へ reverse_proxy する。リポジトリ内の `quickwit-otel` サンプルが同種問題（OTLP HTTP receiver が GET / で 404 を返すので probe が失敗する）を同じパターンで解いていたので、それを踏襲。

```caddy
:6820 {
    @probe path /healthz
    handle @probe {
        respond "ok" 200
    }
    reverse_proxy slurmrestd:6820
}
```

### C4. `get-token.sh` の compose project filter も空振り

```bash
CONTAINER=$(docker ps --filter "label=com.docker.compose.service=slurmctld" \
                       --filter "label=com.docker.compose.project=slurm-rest-api" ...)
```

実 deploy では project ラベルが `slurm-rest-api-accessories`。空ヒットで「slurmctld container not running」エラー。

**修正**: project filter を外して service label のみでマッチ。1 台の VPS 上に slurmctld は 1 つしかいないので問題なし。

---

## Phase 4 — 最終構成と `conoha app deploy` 経由での実検証

### conoha.yml 最終形

```yaml
name: slurm-rest-api
hosts:
  - slurm.example.com
web:
  service: slurm-edge     # Caddy のサイドカーだけ
  port: 6820
  blue_green: false       # 背後の cluster が stateful
health:
  path: /healthz          # Caddy が 200 を返す unauth エンドポイント
  unhealthy_threshold: 24
accessories:              # Slurm 系は全部 accessories に
  - mariadb
  - slurmdbd
  - slurmctld
  - cpu-worker
  - slurmrestd
```

### deploy 結果

```
NAMES                                     STATUS                    IMAGE
slurm-rest-api-9de690b-2-slurm-edge       Up                        caddy:2-alpine
slurm-rest-api-accessories-slurmrestd-1   Up                        slurm-rest-api:local
slurm-rest-api-accessories-cpu-worker-1   Up (healthy)              slurm-rest-api:local
slurm-rest-api-accessories-slurmctld-1    Up (healthy)              slurm-rest-api:local
slurm-rest-api-accessories-slurmdbd-1     Up (healthy)              slurm-rest-api:local
slurm-rest-api-accessories-mariadb-1      Up (healthy)              mariadb:12
conoha-proxy                              Up                        ghcr.io/crowdy/conoha-proxy:latest
```

### smoke_test.py（HTTPS 経由）

```
PASS  openapi/v3 returns 200
PASS  nodes includes >=1 IDLE
PASS  submit returned job_id
PASS  job reached COMPLETED
PASS  smoke job recorded in slurmdb
```

### workload e2e

```
1   COMPLETED  smoke
2   COMPLETED  numpy_matmul         # 188 GFLOPS @ N=2048
3-7 COMPLETED  hyperparam_sweep     # array tasks 0-4 すべて完了
```

7 ジョブ全部 COMPLETED が accounting DB に記録される。

---

## 12 件の総括表

| # | バグ | 検出 phase | 検出経路 |
|---|------|----------|---------|
| 1 | PID ファイルが `/var/run/...` で slurm ユーザーが書けない | Phase 1-A | コード見直し |
| 2 | slurmrestd のプラグイン未明示で slurmdb ルートが消える | Phase 1-A | コード見直し |
| 3 | Ubuntu `slurm-wlm` に `auth/jwt.so` がない | Phase 1-B | 実 VPS smoke |
| 4 | mariadb healthcheck の `mysqladmin` が MariaDB 11 で削除 | Phase 2 | 実 VPS smoke |
| 5 | compose `hostname:` 未指定で DbdHost/SlurmctldHost マッチ失敗 | Phase 2 | 実 VPS smoke |
| 6 | slurmd / slurmrestd に `privileged: true` が必要 | Phase 2 | 実 VPS smoke |
| 7 | service 名 `cpu-worker` でないと entrypoint silent exit | Phase 2 | 実 VPS smoke |
| 8 | `COMPOSE_PROJECT_NAME` env をコンテナに渡す必要 | Phase 2 | 実 VPS smoke |
| 9 | API パスとパーティション名がイメージ依存 | Phase 2 | 実 VPS smoke |
| 10 | `Authorization: Bearer` 併送で 401 | Phase 2 | 実 VPS smoke |
| 11 | `/data` が root 所有でジョブが書けない | Phase 2 | 実 VPS smoke |
| 12 | numpy / sklearn + pip 不在 | Phase 2 | 実 VPS smoke |
| C1 | `COMPOSE_PROJECT_NAME` のハードコード | Phase 3 | conoha-cli ソース見直し |
| C2 | named volume の project scope（slurmrestd を web に置けない） | Phase 3 | conoha-cli ソース見直し |
| C3 | proxy health probe strict 2xx vs JWT 必須 | Phase 3 | conoha-proxy ソース見直し |
| C4 | `get-token.sh` の project filter 空振り | Phase 3 | conoha-cli ソース見直し |

（12 + 4 = 16 件あるように見えますが、Phase 2 の #9, #10 は「API 仕様の差」「Auth ヘッダの相性」で各 1 件のグルーピング、Phase 3 の C1-C4 は「`conoha app deploy` 経路特有の Critical」として独立カウントしました。前者の合計 12 件・後者 4 件の合計 = 16 件として読むのが正確です。）

---

## 教訓（次のサンプルを書く前に確認するチェックリスト）

1. **`docker compose up` で通っただけでは smoke 完了と判定しない**。`conoha app deploy` 経由で実際にデプロイし、web slot と accessories project が分かれている前提で動くかを確認する。
2. **named volume を 2 つの compose project で共有させようとしていないか確認する**。共有が必要なサービスは全部 `accessories:` に置く。`web:` は薄いエッジだけにする（quickwit-otel パターン、本サンプルも採用）。
3. **conoha-proxy の health probe は認証ヘッダなしで 2xx を要求する**。バックエンドが認証必須なら、Caddy サイドカーで `/healthz` を作る。
4. **コードレビューは実機検証の代替にはならない**。Ubuntu の `auth/jwt.so` 抜けのような upstream パッケージング判断は、サンプル側のコードを読むだけでは分からない。
5. **コードレビューは smoke test の代替にもならない**。`docker compose up` 経由の smoke は `conoha app deploy` 経路の問題を捉えない — 検出経路を 2 段階で持つ意義がある。
6. **関連リポジトリのソース照合は強い**。Phase 3 で発見できた C1-C4 は conoha-cli / conoha-proxy のソースまで遡って読んだから出てきた。「サンプル」と「ツール本体」を別物として扱わず、deploy 時の挙動仕様までセットで点検する。

---

## 参考

- マージされた PR: [#99](https://github.com/crowdy/conoha-cli-app-samples/pull/99), [#101](https://github.com/crowdy/conoha-cli-app-samples/pull/101)
- 最終構成: [crowdy/conoha-cli-app-samples — slurm-rest-api](https://github.com/crowdy/conoha-cli-app-samples/tree/main/slurm-rest-api)
- ベースイメージ: [giovtorres/slurm-docker-cluster](https://github.com/giovtorres/slurm-docker-cluster)
- Caddy サイドカーの先行例: `quickwit-otel/` サンプル（同リポジトリ）
- Slurm 公式 JWT 文書: [JSON Web Tokens Authentication](https://slurm.schedmd.com/jwt.html)
- 公開記事（使い方中心の Qiita 版）: <https://qiita.com/crowdy/items/4a6bc40c06205f4acf68>
