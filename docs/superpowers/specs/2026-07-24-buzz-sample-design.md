# Buzz セルフホスト サンプル — 設計

- **日付:** 2026-07-24
- **対象サンプル:** `buzz/`
- **想定フレーバー:** `g2l-t-c4m4` (4 vCPU / 4GB) 推奨。`g2l-t-c3m2` (2GB) は 5 コンテナに対して逼迫（§6 OOM 参照）
- **上流:** [block/buzz](https://github.com/block/buzz) — Rust / Apache-2.0
- **ステータス:** Design (実装前)

## 1. 背景と目的

[Buzz](https://github.com/block/buzz) は Block, Inc. が公開した、**人間と AI エージェントが同じ部屋で作業する** セルフホスト型ワークスペースである。実体は Nostr リレーで、メッセージ・リアクション・ワークフロー・レビュー承認・git イベントのすべてが「署名済みイベント」として 1 本のログに載る。署名者が人間かプロセスかで扱いが変わらない点が中核の設計思想。

本サンプルの目的は、**ConoHa VPS 1 台の上に Buzz リレーを立ち上げ、ブラウザから実際に使える状態にする**こと。`conoha-cli-app-samples` には Nostr / 分散プロトコル系のサンプルがまだ無く、`gitea`・`outline`・`immich` に続く「チーム向けセルフホスト SaaS 代替」系の一つとして位置づける。

このサンプルが提供するもの：

1. `conoha` CLI で CPU VM を 1 台作り、Docker Compose で Buzz スタック（relay + Postgres + Redis + MinIO + Caddy）を起動する。
2. 外部 DNS を用意せずに **HTTPS でブラウザからアクセスできる**（`sslip.io` ワイルドカード DNS + Let's Encrypt）。
3. リレーのオーナー鍵をブートストラップし、**閉じたリレー**として正しく入室できる状態にする。
4. 使い終わったら 1 コマンドで全リソースを破棄する（ブートボリュームを含む）。

**非目標 (Out of Scope):**

- 本番運用（バックアップ・監視・HA・マルチコミュニティ）。上流の `deploy/charts`（Kubernetes）は対象外。
- デスクトップアプリ（Tauri）のビルド・配布。上流リリースの成果物を使う場合の手順は README に参考として記すのみ。
- AI エージェント（`buzz-acp` / Claude Code 等）の接続。**将来の別サンプル / 別 PR とする**（§9）。
- `buzz-cli` の利用（§1.1 の理由によりビルドコストが高い）。
- 自前ドメイン + DNS A レコードの取得手順。

### 1.1 前提となる事実（調査済み・2026-07-24 時点）

すべて実測。出典を併記する。

- **上流リポジトリ**: Rust / Apache-2.0 / ★7,652 / 作成 2026-03-06 / 最終 push 2026-07-24T06:21Z。
  出典: `gh api repos/block/buzz`
- **VPS 向けデプロイ束が公式に存在する**: `deploy/compose/`。上流 README は *"This is the single-node/VPS deployment bundle. It is intentionally separate from the root `docker-compose.yml`, which remains local development infrastructure."* と明記。`compose.yml` / `compose.caddy.yml` / `Caddyfile` / `run.sh` / `.env.example` を含む。
  出典: `deploy/compose/README.md`
- **公式イメージはプリビルド・マルチアーキ**: `ghcr.io/block/buzz:main` は OCI image index で `linux/amd64` と `linux/arm64` を持つ。**VM 上で Rust をビルドする必要はない。**
  出典: `docker manifest inspect ghcr.io/block/buzz:main`
- **イメージに入るバイナリは 3 つだけ**: `buzz-relay` / `buzz-admin` / `buzz-pair-relay`。
  出典: `Dockerfile:67-69`（`cargo build --release --locked -p buzz-relay ... -p buzz-admin ... -p buzz-pair-relay`）、`Dockerfile:138-140`
- **`buzz-cli` はプリビルドが存在しない**: 上記のとおりイメージに含まれず、最新リリース `v0.4.24` の成果物も `.dmg` / `.AppImage` / `.deb` / `.exe` のデスクトップアプリのみ。`buzz-cli` を使うには VM 上で cargo build が必要になるため、本サンプルでは使わない。
  出典: `gh api repos/block/buzz/releases/latest`
- **イメージは Web UI を同梱し、既定で `/` に配信する**: `web/dist` と `admin-web/dist` がイメージにコピーされ、`BUZZ_WEB_DIR` が**イメージの ENV として既定設定**されている。`.env.example` は *"When set, the relay serves the web frontend at / for browser requests."* と説明する。→ **ブラウザだけで利用でき、デスクトップアプリは必須ではない。**
  出典: `Dockerfile:141-142`, `Dockerfile:145`（`ENV BUZZ_WEB_DIR=/srv/buzz/web`）, ルート `.env.example:53-55`
- **`buzz-admin` に鍵生成とメンバー管理がある**: `GenerateKey`（*"Generate a new Nostr keypair (for bootstrapping)"*）、`AddMember`、`RemoveMember`、`ListMembers`、`Migrate`、`ReconcileChannels`。**ブートストラップと検証がイメージ内バイナリだけで完結する。**
  出典: `crates/buzz-admin/src/main.rs:42-96`
- **既定は「閉じたリレー」**: `deploy/compose/.env.example` は `BUZZ_REQUIRE_AUTH_TOKEN=true` / `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true` / `RELAY_OWNER_PUBKEY=CHANGE_ME_OWNER_PUBKEY_HEX`。オーナー公開鍵を正しく入れないと**自分のリレーに入れない**。
  出典: `deploy/compose/.env.example`
- **TLS モードではホストに公開されるリレーポートが無くなる**: `compose.yml` は `relay.ports: ["${BUZZ_HTTP_PORT:-3000}:3000"]` だが、`compose.caddy.yml` が `relay.ports: !reset []` で解除する。ヘルス (8080) とメトリクス (9102) は `EXPOSE` のみで publish されない。
  出典: `deploy/compose/compose.yml`, `deploy/compose/compose.caddy.yml`, `Dockerfile:148`
- **ワイルドカード DNS は現時点で解決する**: `203-0-113-42.sslip.io` / `203.0.113.42.nip.io` / `203-0-113-42.traefik.me` いずれも正引き可能。
  出典: `getent hosts`（2026-07-24 実行）
- **`sslip.io` は Let's Encrypt の weekly rate limit に当たった実績がある**: 本リポジトリのポストモーテムに `HTTP 429 rateLimited - too many certificates (250000) already issued for "sslip.io" in the last 168h` が記録され、*「sslip.io は『運が良ければ通る』前提で」*と結論されている。→ §6 のフォールバック設計の根拠。
  出典: `docs/postmortems/2026-05-14-slurm-rest-api-gpu-worker.md:61-69`
- **フレーバー名**: `g2l-t-c4m4` = 4 vCPU / 4GB（`-t-` は時間課金）。`g2l-t-4` のような名前は存在しない。
  出典: `conoha flavor list`（2026-07-24 実行）

## 2. アーキテクチャ概要

```
  [ローカル PC]                       [ConoHa VPS  g2l-t-c4m4 / Ubuntu]
   conoha CLI ── server create ──────▶ 公開 IPv4
       |                                    |
       |  scripts/up.sh (SSH 越しに実行)     v
       └────────────────────────────▶ ┌─────────────────────────────────┐
                                      │ git clone block/buzz @ 固定 ref │
                                      │ deploy/compose/  (上流そのまま) │
                                      │   + .env  ← bootstrap-env.sh    │
                                      └───────────────┬─────────────────┘
                                                      │ BUZZ_COMPOSE_TLS=true ./run.sh start
                                                      v
   ブラウザ ── https://<ip-dashes>.sslip.io ──▶  caddy :80/:443
                                                      │  (Let's Encrypt / reverse_proxy)
                                                      v
                                                 relay :3000
                                          (WebSocket + REST + Web UI 配信)
                                                      │
                        ┌─────────────────────────────┼─────────────────────────────┐
                        v                             v                             v
                   postgres:17                     redis:7                        minio
                (イベント + FTS 検索)              (pub/sub)                 (メディア / Blossom)
```

**設計上の要点:**

- `conoha proxy`（blue/green）は**使わない**。Caddy が 80/443 を直接握るため。本リポジトリ README が認めている例外パターン（`vllm-gpu`・`personal-dashboard`・`dokploy`・`vcluster` と同じ扱い）に該当し、`conoha.yml` は置かない。デプロイは `--no-proxy` 系の手動フローとする。
- Web UI は relay が配信するため、フロントエンド用のコンテナは無い（§1.1）。
- 上流の `deploy/compose/` には一切パッチを当てない。差分は `.env` の生成と、フォールバック時の `Caddyfile` 差し替えに限定する。

## 3. ファイル構成（ハイブリッド方式）

```
buzz/
├── README.md              # 日本語。手順 / 注意点 / トラブルシュート / 参考
├── scripts/
│   ├── up.sh              # VM 作成 → Docker → clone → bootstrap → 起動
│   ├── bootstrap-env.sh   # ★本サンプルの中核★ VM 内で .env を生成
│   ├── verify.sh          # 完了条件の再実行（証拠キャプチャ用）
│   └── down.sh            # 全リソース破棄（ブートボリューム含む）
└── .buzz-ref              # 上流 git ref とイメージタグを 1 か所で管理
```

**なぜ「上流を固定 ref で clone し、オーバーレイだけ持つ」のか:**

- 上流 `deploy/compose/` は上流自身が保守・検証している VPS 向け束であり、コピーすると即座に古いフォークになる（Buzz は本日も push される開発速度）。
- 一方 ref を固定しないと再現できず、本リポジトリの「完了報告には再実行結果を含める」規約を満たせない。
- 実際に価値があるのは `.env` の `CHANGE_ME` を埋める部分であり、それがちょうどオーバーレイの範囲に収まる。

`.buzz-ref` の内容（例）:

```sh
# 上流の固定 ref とイメージタグ。両方を同時に更新すること。
BUZZ_GIT_REF=<実装時に確定する tag または commit>
BUZZ_IMAGE=ghcr.io/block/buzz:<実装時に確定する sha- タグ>
```

> 実装時に、その時点の最新リリース tag と、それに対応する `ghcr.io/block/buzz:sha-<7>` を実測して確定する。上流 README も *"Pin it to `ghcr.io/block/buzz:sha-<7>` or a semver release tag for production"* と推奨している。

## 4. `bootstrap-env.sh` が生成する `.env`

`deploy/compose/.env.example` を基に、次を埋める。

`bootstrap-env.sh` は **VM 内で実行**し、公開 IPv4 は**第 1 引数として `up.sh` から渡す**（§5 手順 4 でローカル側が `conoha server show` から取得済みのため、VM 側で再検出しない。メタデータサービス依存を避ける）。

`buzz-admin` を呼ぶ際は **ENTRYPOINT の上書きが必要**である。イメージの `ENTRYPOINT` は `buzz-relay` に固定されているため（`Dockerfile:157`）、スタック起動前は
`docker run --rm --entrypoint buzz-admin $BUZZ_IMAGE generate-key`、
起動後は `docker compose exec relay buzz-admin <cmd>` を使う。

| 分類 | 変数 | 生成方法 |
|---|---|---|
| ドメイン連動 | `BUZZ_DOMAIN` | 引数で受けた公開 IPv4 → `<ip-dashes>.sslip.io` |
| | `RELAY_URL` | `wss://<BUZZ_DOMAIN>` |
| | `BUZZ_MEDIA_BASE_URL` | `https://<BUZZ_DOMAIN>/media` |
| | `BUZZ_MEDIA_SERVER_DOMAIN` | `<BUZZ_DOMAIN>` |
| | `BUZZ_CORS_ORIGINS` | `https://<BUZZ_DOMAIN>` |
| ランダム秘密 | `BUZZ_GIT_HOOK_HMAC_SECRET` | `openssl rand -hex 32` |
| | `POSTGRES_PASSWORD` / `REDIS_PASSWORD` | `openssl rand -hex 32` |
| | `TYPESENSE_API_KEY` | `openssl rand -hex 32` |
| | `BUZZ_S3_ACCESS_KEY` / `BUZZ_S3_SECRET_KEY` | `openssl rand -hex 32` |
| Nostr 鍵 | `BUZZ_RELAY_PRIVATE_KEY` | `buzz-admin generate-key`（リレー自身の署名鍵） |
| | `RELAY_OWNER_PUBKEY` | `buzz-admin generate-key`（**オーナー用に別途生成**） |
| 固定 | `BUZZ_IMAGE` | `.buzz-ref` から |
| | `BUZZ_AUTO_MIGRATE` | `true`（新規 DB のため） |

**オーナー秘密鍵の扱い（重要）:**

`RELAY_OWNER_PUBKEY` に入れるのは公開鍵のみ。対応する**秘密鍵は `.env` にもディスクにも保存せず、ブートストラップ時に標準出力へ 1 回だけ表示**し、利用者がブラウザのログインに使う。Nostr は鍵の所有がアイデンティティそのものであり、サーバ側に置くと設計思想に反するため。README にも「この 1 回しか表示されない」ことを明記する。

`buzz-admin generate-key` は DB 接続を要さない想定だが、要さない保証は未確認（§8）。要する場合は Postgres 起動後に実行する順序へ組み替える。

## 5. 実行フロー（`scripts/up.sh`）

```
 1. keypair / セキュリティグループ作成
 2. SG ルール: ingress tcp 22（管理）, 80（ACME HTTP-01）, 443（サービス）
 3. VM 作成    conoha server create --flavor g2l-t-c4m4 --image <検出値>
                 --key-name --security-group --no-input --wait
 4. 公開 IPv4 抽出
 5. SSH 準備   ssh-keygen -R <ip> ; ssh-keyscan -H <ip> >> ~/.ssh/known_hosts
 6. Docker 導入 (get.docker.com)
 7. 上流 clone  git clone --depth 1 --branch $BUZZ_GIT_REF
 8. .env 生成   bootstrap-env.sh
 9. 起動        BUZZ_COMPOSE_TLS=true ./run.sh start
10. 検証        verify.sh
```

**手順 4・5 は本リポジトリで蓄積された罠の回避である:**

- `conoha server show --format json` の `addresses` は**ネットワーク名をキーとする dict** であり、各値は `{addr, version}` のリスト。配列インデックス（`addresses[0]`）で取ると壊れる。`version == 4` で選ぶ。
- `conoha server ssh --insecure` は CLI v0.7.1 で実動作しなかった記録がある（新規 VPS で `Host key verification failed`）。現在の CLI は v0.8.0-3-gfbb5f41 で修正済みか未確認（§8）。**バージョンに依存しない `ssh-keyscan` 事前シードに依拠する**ことで、この不確実性を設計から外す。
- イメージ名は `ubuntu-26.04` を決め打ちせず、`conoha image list` で確認してから使う。無ければ即座に失敗させる。

## 6. 失敗処理 — silent → loud

| 失敗 | 検出方法 | 処理 |
|---|---|---|
| **`sslip.io` の LE レート制限 (429)** — 実績あり（§1.1） | `docker compose logs caddy` に `rateLimited` / `429` | ① `nip.io` に切替えて再試行（別の登録ドメインなので LE のクォータが独立）→ ② それでも失敗なら `Caddyfile` に `tls internal`（Caddy 内蔵 CA / 自己署名、レート制限なし）。**フォールバック発動時はバナーで大きく出力し、最終的にどの TLS 経路で通ったかを `verify.sh` の出力に必ず残す** |
| **閉じたリレーで入室できない** | `buzz-admin list-members` にオーナーが居ない | 異常終了。黙って進むとブラウザ側で原因不明の入室失敗になる |
| **ACME 失敗（80 が閉じている）** | Caddy ログ | SG ルールを事前検証し、欠けていれば中断 |
| **メモリ不足 (OOM)** | `docker stats` スナップショット + `dmesg \| grep -i oom` | 失敗時に `g2l-t-c6m8` (8GB) へ上げる経路を README に明記 |
| **イメージ / フレーバー不在** | `conoha image list` / `conoha flavor list` の照会失敗 | 仮定せず中断 |

フォールバックは自動で行うが、**成功したように見せかけない**。どの経路で終わったかが最終出力に残る（本リポジトリ CLAUDE.md の「失敗は silent → loud」原則）。

## 7. 検証 / 完了条件

すべて `2>&1 | tee -a <ログ>` で**ターミナル原文をキャプチャ**する。要約・言い換えは証拠として認めない。

`verify.sh` は **VM 内で実行する部分**（1・4）と**ローカルから実行する部分**（2・3）に分かれる。ローカル側から叩くことで「外部からアクセスできる」ことまで含めて証明する（VM 内の `127.0.0.1` だけでは SG / Caddy / ACME の検証にならない）。

| # | 項目 | 実行場所 | 合格条件 |
|---|---|---|---|
| 1 | リレー生存 | VM | `docker compose exec relay` 経由の `/_liveness` が `200 OK` |
| 2 | Web UI 配信 | ローカル | `curl -fsSI https://<fqdn>/` が `200` かつ `content-type: text/html` |
| 3 | WebSocket | ローカル | `wss://<fqdn>` へのアップグレードが `101 Switching Protocols` |
| 4 | オーナー登録 | VM | `docker compose exec relay buzz-admin list-members` にオーナー pubkey が出る |
| 5 | ブラウザ実機 | ローカル | ログインしてチャンネルを 1 つ作成（スクリーンショット 1 枚 / 人間確認用・任意） |
| 6 | 後始末 | ローカル | `down.sh` 実行後、`conoha server list` / ボリューム一覧ともに残存 0 件 |

> ⚠️ **上流 README の検証スニペットをそのまま使ってはいけない。** 上流は
> `curl -fsS "http://127.0.0.1:$BUZZ_HTTP_PORT/_liveness"` を案内するが、TLS モードでは
> `compose.caddy.yml` の `ports: !reset []` によりホストに公開されるリレーポートが無くなる（§1.1）。
> さらに `_liveness` はヘルスポート 8080 側であり、3000 にも同じパスがあるかは未確認（§8）。
> `verify.sh` は**両方の経路を試し、どちらで通ったかを出力する**設計とする。

## 8. 未確認事項（実装時に潰す）

いずれも「仮定」であり、断定しない。実装フェーズで実機確認し、結果を PR に記す。

1. `_liveness` がリレーの 3000 番にも存在するか（8080 のみか）。→ `verify.sh` が両経路を試すことで実測に置き換える。
2. `conoha` CLI v0.8.0 で `server ssh --insecure` が実動作するか。→ 依存しない設計にしているため、結果に関わらずブロッカーにはならない。
3. `buzz-admin generate-key` が DB 接続なしで動くか。→ 動かない場合は Postgres 起動後に実行する順序へ組み替える。
4. `g2l-t-c4m4` (4GB) で 5 コンテナが安定動作するか。→ `docker stats` で実測する。
5. `sslip.io` の LE クォータに現在余裕があるか。→ 実行時にしか分からないため §6 のフォールバックで吸収する。
6. `ubuntu-26.04` が現在もカタログにあるか。→ `conoha image list` で照会してから使う。
7. リレーが実際に `/` で Web UI を返すか。→ `Dockerfile` の ENV 設定という強い根拠はあるが、実行確認は未了。完了条件 2 で確定する。
8. `TYPESENSE_API_KEY` が `.env.example` にあるが `compose.yml` に typesense サービスが無い（README は検索を Postgres FTS と説明）。無害な残骸と推測されるが未確認のため、値は生成しておく。

## 9. 将来の拡張（本 PR では扱わない）

- **AI エージェント接続**: `buzz-acp` ハーネス経由で Claude Code / goose / Codex をチャンネルに参加させる。Buzz の中核的な価値だが、`buzz-acp` のビルドと LLM 認証（OAuth or API キー）が絡み、スコープが跳ね上がるため別サンプル / 別 PR とする。
- **自前ドメイン + A レコード**での運用（LE レート制限を根本回避）。
- デスクトップアプリ（Tauri）からの接続手順。
- `deploy/charts` を使った Kubernetes デプロイ。

## 10. 参考

- [block/buzz](https://github.com/block/buzz) — 上流リポジトリ
- `deploy/compose/README.md` — 上流の VPS デプロイ手順
- `ARCHITECTURE.md` / `NOSTR.md` — 上流の設計文書
- `docs/postmortems/2026-05-14-slurm-rest-api-gpu-worker.md` — `sslip.io` の LE レート制限（G5）
- 本リポジトリ README「自分のアプリをデプロイするには」— `conoha.yml` を置かない例外パターンの規定
