# Buzz セルフホスト サンプル — 設計

- **日付:** 2026-07-24
- **対象サンプル:** `buzz/`
- **想定フレーバー:** `g2l-t-c6m8` (6 vCPU / 8GB)。リレー 5 コンテナに加えて **VM 上で Rust ビルドを行う**ため（§3.1）
- **上流:** [block/buzz](https://github.com/block/buzz) — Rust / Apache-2.0
- **ステータス:** Design rev.2 (実装前)

## 0. 改訂履歴

| rev | 日付 | 変更 |
|---|---|---|
| 1 | 2026-07-24 | 初版。AI エージェント連携と `buzz-cli` を非目標とし、リレー + Web UI のみを対象とした |
| **2** | **2026-07-24** | **AI エージェント連携を目標に格上げ**（利用者判断）。これに伴い ①`buzz-acp` + `buzz-cli` の VM 上ビルドを追加 ②フレーバーを 4GB → 8GB に引き上げ ③上流ドキュメントの陳腐化（`mint-token` 不在）と認証トークン取得経路の欠落を新たなリスクとして記載 ④Claude 認証を「サブスクリプション OAuth を先に試し、失敗時に API キーへフォールバック」と決定 |

> rev 1 は本ファイルの git 履歴（コミット `cf50d53`）に残る。rev 2 で追加した事実はすべて §1.1 に出典付きで記載する。

## 1. 背景と目的

[Buzz](https://github.com/block/buzz) は Block, Inc. が公開した、**人間と AI エージェントが同じ部屋で作業する** セルフホスト型ワークスペースである。実体は Nostr リレーで、メッセージ・リアクション・ワークフロー・レビュー承認・git イベントのすべてが「署名済みイベント」として 1 本のログに載る。署名者が人間かプロセスかで扱いが変わらない点が中核の設計思想であり、**エージェントが「ボット」ではなく鍵を持つ一員として参加する**ことがこのプロダクトの主張そのものである。

本サンプルの目的は、**ConoHa VPS 1 台の上に Buzz リレーを立ち上げ、ブラウザから使える状態にしたうえで、AI エージェントを 1 体そこに常駐させる**こと。`conoha-cli-app-samples` には Nostr / 分散プロトコル系のサンプルが無く、また「LLM エージェントをインフラとして常駐させる」サンプルも無いため、両方の入口となる。

このサンプルが提供するもの：

1. `conoha` CLI で CPU VM を 1 台作り、Docker Compose で Buzz スタック（relay + Postgres + Redis + MinIO + Caddy）を起動する。
2. 外部 DNS を用意せずに **HTTPS でブラウザからアクセスできる**（`sslip.io` ワイルドカード DNS + Let's Encrypt）。
3. リレーのオーナー鍵をブートストラップし、**閉じたリレー**として正しく入室できる状態にする。
4. **AI エージェント（Claude）を独自の Nostr 鍵を持つ参加者として常駐させ、チャンネルで `@mention` すると応答する**ところまでを実証する。
5. 使い終わったら 1 コマンドで全リソースを破棄する（ブートボリュームを含む）。

**非目標 (Out of Scope):**

- 本番運用（バックアップ・監視・HA・マルチコミュニティ）。上流の `deploy/charts`（Kubernetes）は対象外。
- デスクトップアプリ（Tauri）のビルド・配布。上流リリース成果物を使う場合の手順は README に参考として記すのみ。
- 複数エージェントの同時常駐、ワークフロー（YAML 自動化）、git ホスティング機能、huddle。エージェントは **1 体**に限る。
- 自前ドメイン + DNS A レコードの取得手順。
- エージェントへの権限設計・ガードレールの作り込み（`BUZZ_ACP_SUBSCRIBE=mentions` の既定に従うのみ）。

### 1.1 前提となる事実（調査済み・2026-07-24 時点）

すべて実測。出典を併記する。

#### リレー基盤

- **上流リポジトリ**: Rust / Apache-2.0 / ★7,652 / 作成 2026-03-06 / 最終 push 2026-07-24T06:21Z。
  出典: `gh api repos/block/buzz`
- **VPS 向けデプロイ束が公式に存在する**: `deploy/compose/`。上流 README は *"This is the single-node/VPS deployment bundle. It is intentionally separate from the root `docker-compose.yml`, which remains local development infrastructure."* と明記。
  出典: `deploy/compose/README.md`
- **公式イメージはプリビルド・マルチアーキ**: `ghcr.io/block/buzz:main` は `linux/amd64` と `linux/arm64` を持つ。**リレーの起動に Rust ビルドは不要。**
  出典: `docker manifest inspect ghcr.io/block/buzz:main`
- **イメージに入るバイナリは 3 つだけ**: `buzz-relay` / `buzz-admin` / `buzz-pair-relay`。
  出典: `Dockerfile:67-69`, `Dockerfile:138-140`
- **イメージは Web UI を同梱し、既定で `/` に配信する**: `BUZZ_WEB_DIR` がイメージの ENV として既定設定されている。→ **ブラウザだけで利用でき、デスクトップアプリは必須ではない。**
  出典: `Dockerfile:141-142`, `Dockerfile:145`, ルート `.env.example:53-55`
- **`buzz-admin` に鍵生成とメンバー管理がある**: `AddMember` / `RemoveMember` / `ListMembers` / `GenerateKey` / `Migrate` / `ProductFeedback` / `ReconcileChannels`。
  出典: `crates/buzz-admin/src/main.rs:42-96`
- **既定は「閉じたリレー」**: `BUZZ_REQUIRE_AUTH_TOKEN=true` / `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true` / `RELAY_OWNER_PUBKEY=CHANGE_ME_OWNER_PUBKEY_HEX`。
  出典: `deploy/compose/.env.example`
- **TLS モードではホストに公開されるリレーポートが無くなる**: `compose.caddy.yml` が `relay.ports: !reset []` で解除する。ヘルス (8080) とメトリクス (9102) は `EXPOSE` のみ。
  出典: `deploy/compose/compose.yml`, `deploy/compose/compose.caddy.yml`, `Dockerfile:148`
- **ワイルドカード DNS は現時点で解決する**: `sslip.io` / `nip.io` / `traefik.me` いずれも正引き可能。
  出典: `getent hosts`（2026-07-24 実行）
- **`sslip.io` は LE の weekly rate limit に当たった実績がある**: `HTTP 429 rateLimited - too many certificates (250000) already issued for "sslip.io" in the last 168h`。
  出典: `docs/postmortems/2026-05-14-slurm-rest-api-gpu-worker.md:61-69`
- **フレーバー名**: `g2l-t-c6m8` = 6 vCPU / 8GB、`g2l-t-c4m4` = 4 vCPU / 4GB（`-t-` は時間課金）。`g2l-t-4` のような名前は存在しない。
  出典: `conoha flavor list`（2026-07-24 実行）

#### エージェント連携（rev 2 で追加）

- **`buzz-acp` はプリビルドが存在せず、cargo ビルドが必要**: 上流 README は `cargo build --release -p buzz-acp` と `export PATH="$PWD/target/release:$PATH"` を指示する。リレーイメージにも最新リリース `v0.4.24` の成果物（`.dmg`/`.AppImage`/`.deb`/`.exe`）にも含まれない。
  出典: `crates/buzz-acp/README.md:22-24`, `Dockerfile:67-69`, `gh api repos/block/buzz/releases/latest`
- **`buzz-cli` も同時に必要**: ハーネスの構成は `Buzz Relay ──WS──→ buzz-acp ──stdio──→ Your Agent → Buzz CLI` であり、*"the agent replies using the Buzz CLI that the harness configures automatically"* と説明される。`crates/buzz-acp/src/config.rs` が `buzz-cli` を参照する。→ ビルド対象は **`-p buzz-acp -p buzz-cli` の 2 つ**。
  出典: `crates/buzz-acp/README.md:3-8,23,56,248`, `gh api search/code`（`buzz-cli` in `crates/buzz-acp/src`）
- **`docker-compose.harness.yml` はエージェント用ではない**: 名前に反し *"Isolated test-relay backing stack — GUI read-model overhaul harness"* であり、GUI テスト用の隔離 Postgres/Redis/MinIO にすぎない。エージェント導入のショートカットにはならない。
  出典: `docker-compose.harness.yml` 冒頭コメント
- **Claude 連携は npm アダプタ経由**: `npm install -g @agentclientprotocol/claude-agent-acp` + `BUZZ_ACP_AGENT_COMMAND="claude-agent-acp"`。→ **VM に Node.js/npm も必要**。旧名 `claude-code-acp` も受け付ける。
  出典: `crates/buzz-acp/README.md:74-90`
- **⚠️ 上流が文書化している Claude 認証は API キーのみ**: 上流は `export ANTHROPIC_API_KEY="sk-ant-..."` と記す。ACP README を `oauth|subscription|login` で検索しても**サブスクリプション OAuth の記述は無い**。さらに直近の Codex 項では *"required — use an OpenAI API key, not a ChatGPT subscription"* と、サブスクリプション認証を明示的に排除している。
  → **「Claude Pro/Max のサブスクリプション OAuth で動く」という説は上流ドキュメントの裏付けが無い**。アダプタが Claude Agent SDK を包む以上ローカル資格情報を拾う可能性は否定しないが、**現時点では [仮定] であり、実測で確定させる**（§5.1・§8）。
  出典: `crates/buzz-acp/README.md:67,72,80-84`, `command grep -niE "oauth|subscription|login" crates/buzz-acp/README.md`
- **⚠️ 上流ドキュメントが陳腐化している — エージェント鍵の発行手順が存在しない**: ACP README は `cargo run -p buzz-admin -- mint-token --name "my-agent" --scopes "..."` を案内するが、**`buzz-admin` に `mint-token` は無い**。ソース全体で `mint|token` の一致が 0 件であり、`mint-token` の出現は文書 2 ファイルのみ。
  → エージェント用の鍵は `buzz-admin generate-key` + `add-member` で代替する（§5.1）。ただし `BUZZ_API_TOKEN` の取得経路は**不明のまま**であり、`BUZZ_REQUIRE_AUTH_TOKEN=true` と衝突しうる（§6・§8）。
  出典: `command grep -niE "mint|token" crates/buzz-admin/src/main.rs`（出力 0 行）, `gh api "search/code?q=repo:block/buzz+mint-token"`（`crates/buzz-acp/README.md` と `crates/buzz-cli/TESTING.md` の 2 件のみ）
- **ハーネスの既定挙動**: `BUZZ_ACP_SUBSCRIBE=mentions`（@メンションのみ反応）、`BUZZ_ACP_AGENTS=1`、`BUZZ_ACP_IDLE_TIMEOUT=620`。エージェントは既定で**メンバーになっているチャンネルのみ**を購読する（`GET /api/channels?member=true`）。
  出典: `crates/buzz-acp/README.md:42,99-110`, ルート `.env.example:185-215`

## 2. アーキテクチャ概要

```
  [ローカル PC]                       [ConoHa VPS  g2l-t-c6m8 / Ubuntu]
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
                        ┌─────────────────────────────┼──────────────┬──────────────┐
                        v                             v              v              │
                   postgres:17                     redis:7        minio             │
                (イベント + FTS 検索)              (pub/sub)   (メディア)            │
                                                                                    │ WS (agent 鍵で認証)
                                      ┌─────────────────────────────────────────────┘
                                      v
                        ┌───────────────────────────────────────────┐
                        │ buzz-acp  (systemd, ホスト上のプロセス)    │
                        │   ├ 自身の Nostr 鍵 = エージェントの身元   │
                        │   └ stdio ─▶ claude-agent-acp (npm)       │
                        │                  └─▶ Claude (OAuth/APIキー)│
                        │      応答は buzz-cli 経由で relay へ書き戻し│
                        └───────────────────────────────────────────┘
```

**設計上の要点:**

- `conoha proxy`（blue/green）は**使わない**。Caddy が 80/443 を直接握るため。本リポジトリ README が認めている例外パターン（`vllm-gpu`・`personal-dashboard`・`dokploy`・`vcluster` と同じ扱い）に該当し、`conoha.yml` は置かない。
- Web UI は relay が配信するため、フロントエンド用のコンテナは無い。
- 上流の `deploy/compose/` には一切パッチを当てない。差分は `.env` の生成と、フォールバック時の `Caddyfile` 差し替えに限定する。
- **`buzz-acp` はコンテナ化せず、ホスト上の systemd サービスとして動かす。** 上流がコンテナイメージを提供しておらず、独自 Dockerfile を書くと上流の変更に追従できなくなるため。ビルド成果物（2 バイナリ）を `/usr/local/bin` に置く。

## 3. ファイル構成（ハイブリッド方式）

```
buzz/
├── README.md              # 日本語。手順 / 注意点 / トラブルシュート / 参考
├── scripts/
│   ├── up.sh              # VM 作成 → Docker → clone → bootstrap → 起動
│   ├── bootstrap-env.sh   # VM 内で .env を生成
│   ├── agent-up.sh        # ★rev2★ Rust/Node 導入 → buzz-acp/buzz-cli ビルド
│   │                      #        → エージェント鍵発行 → systemd 登録
│   ├── verify.sh          # 完了条件の再実行（証拠キャプチャ用）
│   └── down.sh            # 全リソース破棄（ブートボリューム含む）
└── .buzz-ref              # 上流 git ref とイメージタグを 1 か所で管理
```

**なぜ「上流を固定 ref で clone し、オーバーレイだけ持つ」のか:**

- 上流 `deploy/compose/` は上流自身が保守・検証している VPS 向け束であり、コピーすると即座に古いフォークになる（Buzz は本日も push される開発速度）。
- 一方 ref を固定しないと再現できず、本リポジトリの「完了報告には再実行結果を含める」規約を満たせない。
- **rev 2 ではこの選択の重要度が上がった**: `buzz-acp` を**ソースからビルドする**以上、ソースの ref とイメージタグが一致していなければハーネスとリレーのプロトコル整合が保証されない。`.buzz-ref` が単一の真実になる。

`.buzz-ref` の内容（例）:

```sh
# 上流の固定 ref とイメージタグ。両方を同時に更新すること。
# BUZZ_GIT_REF からビルドした buzz-acp/buzz-cli が、
# BUZZ_IMAGE のリレーと同じコミット由来であることを保証する。
BUZZ_GIT_REF=<実装時に確定する tag または commit>
BUZZ_IMAGE=ghcr.io/block/buzz:<対応する sha- タグ>
```

> 実装時に、その時点の最新リリース tag と、それに対応する `ghcr.io/block/buzz:sha-<7>` を実測して確定する。上流 README も *"Pin it to `ghcr.io/block/buzz:sha-<7>` or a semver release tag for production"* と推奨している。

### 3.1 なぜ 8GB フレーバーなのか

`buzz-acp` と `buzz-cli` を VM 上で `cargo build --release` するため。Buzz は Rust ワークスペースであり、リリースビルドは依存クレートのコンパイルでメモリを消費する。4GB では**リレー 5 コンテナが常駐した状態での並行ビルド**が OOM に至るリスクが高い。`-t-` は時間課金であり、サンプル実行中のみ課金されるため 8GB を既定とする。

ビルド後にリレーだけを動かすなら 4GB で足りる可能性があるが、本サンプルはワンショット構築を前提とするため分けない。実測値は §7 の証拠として残す。

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

## 5. 実行フロー

### 5.0 リレー構築（`scripts/up.sh`）

```
 1. keypair / セキュリティグループ作成
 2. SG ルール: ingress tcp 22（管理）, 80（ACME HTTP-01）, 443（サービス）
 3. VM 作成    conoha server create --flavor g2l-t-c6m8 --image <検出値>
                 --key-name --security-group --no-input --wait
 4. 公開 IPv4 抽出
 5. SSH 準備   ssh-keygen -R <ip> ; ssh-keyscan -H <ip> >> ~/.ssh/known_hosts
 6. Docker 導入 (get.docker.com)
 7. 上流 clone  git clone --depth 1 --branch $BUZZ_GIT_REF
 8. .env 生成   bootstrap-env.sh <公開IPv4>
 9. 起動        BUZZ_COMPOSE_TLS=true ./run.sh start
10. 検証        verify.sh（リレー部分）
```

**手順 4・5 は本リポジトリで蓄積された罠の回避である:**

- `conoha server show --format json` の `addresses` は**ネットワーク名をキーとする dict** であり、各値は `{addr, version}` のリスト。配列インデックス（`addresses[0]`）で取ると壊れる。`version == 4` で選ぶ。
- `conoha server ssh --insecure` は CLI v0.7.1 で実動作しなかった記録がある。現在の CLI は v0.8.0-3-gfbb5f41 で修正済みか未確認（§8）。**バージョンに依存しない `ssh-keyscan` 事前シードに依拠する**ことで、この不確実性を設計から外す。
- イメージ名は `ubuntu-26.04` を決め打ちせず、`conoha image list` で確認してから使う。無ければ即座に失敗させる。

### 5.1 エージェント常駐（`scripts/agent-up.sh`）— rev 2 で追加

```
 1. ツールチェーン導入   rustup (stable) + Node.js LTS + npm
 2. ハーネスのビルド     cd <clone先> && cargo build --release -p buzz-acp -p buzz-cli
                        install -m755 target/release/{buzz-acp,buzz-cli} /usr/local/bin/
 3. ACP アダプタ導入     npm install -g @agentclientprotocol/claude-agent-acp
 4. エージェント身元発行  buzz-admin generate-key           → agent 鍵ペア
                        buzz-admin add-member --pubkey <agent_pub> --role member
                        （※ 上流 README の mint-token は存在しない。§1.1 参照）
 5. Claude 認証         5-a. まずサブスクリプション OAuth を試す（§5.2 の手順）
                        5-b. 失敗したら ANTHROPIC_API_KEY にフォールバック
                        いずれで通ったかを必ず記録する（§6）
 6. systemd 登録         buzz-acp を Restart=on-failure で常駐化
                        環境: BUZZ_PRIVATE_KEY=<agent_nsec>
                              BUZZ_RELAY_URL=wss://<BUZZ_DOMAIN>
                              BUZZ_ACP_AGENT_COMMAND=claude-agent-acp
                              BUZZ_ACP_SUBSCRIBE=mentions
 7. 疎通確認             ブラウザでチャンネルを作り、エージェントを招待して @mention
```

**手順 4 の注意**: エージェントは既定でメンバーであるチャンネルのみ購読する。上流 README は *"Private channels require explicit membership. The relay doesn't yet have a REST/event API for managing channel members — this is a known gap."* と述べているため、**チャンネルへの招待方法は実装時に実機で確定する**（Web UI 経由が有力）。

**手順 5 の位置づけ**: サブスクリプション OAuth は §1.1 のとおり上流に記述が無く [仮定] である。**先に試すが、動かないことも想定内**とし、フォールバックを必ず用意する。結果は事実として README に記録する（動く／動かないのどちらであっても、それ自体がこのサンプルの価値ある成果になる）。

### 5.2 サブスクリプション OAuth をどう VM に持ち込むか

**新規 VM にはログイン済みの Claude 資格情報が存在しない。** サブスクリプション OAuth を試す以上、資格情報を VM 側に用意する手段が要る。この手順を曖昧にしたままでは実装者が判断に詰まるため、選択肢と方針を先に決めておく。

| 案 | 内容 | 評価 |
|---|---|---|
| **O-1（第一候補）** | VM 上で対話的にログインする。`ssh -t` で PTY を確保し、表示された URL をローカルのブラウザで開いてコードを貼り戻す | 資格情報をファイルとして持ち出さないため最も安全。**ただし完全自動化はできず、`up.sh` に人手の介在点が 1 つ入る** |
| O-2 | ローカルの資格情報ファイルを VM へコピーする | 自動化はできるが、**サブスクリプションの認証情報をサーバへ複製する**ことになり、利用規約・セキュリティの両面で推奨しない。採らない |
| O-3 | 諦めて `ANTHROPIC_API_KEY` を使う | §5.1 手順 5-b のフォールバックそのもの |

**方針**: O-1 を試し、駄目なら O-3。**O-2 は採用しない。** `agent-up.sh` は O-1 の対話ステップで一旦停止し、利用者に操作を促す設計とする（黙って O-3 に落ちない）。

なお、この検証の結論が「サブスクリプション OAuth では動かない」であっても失敗ではない。**上流ドキュメントに無い事項を実測で確定させた記録**として README と PR に残すこと自体が成果である。

そもそも `claude-agent-acp` がどの認証経路を実装しているかは未確認（§8-9）。実装時はアダプタ側のドキュメントを一次情報として確認してから着手する。

## 6. 失敗処理 — silent → loud

| 失敗 | 検出方法 | 処理 |
|---|---|---|
| **`sslip.io` の LE レート制限 (429)** — 実績あり（§1.1） | `docker compose logs caddy` に `rateLimited` / `429` | ① `nip.io` に切替えて再試行（別の登録ドメインなので LE のクォータが独立）→ ② それでも失敗なら `Caddyfile` に `tls internal`（Caddy 内蔵 CA / 自己署名）。**フォールバック発動時はバナーで大きく出力し、最終的にどの TLS 経路で通ったかを `verify.sh` の出力に必ず残す** |
| **閉じたリレーで入室できない** | `buzz-admin list-members` にオーナーが居ない | 異常終了。黙って進むとブラウザ側で原因不明の入室失敗になる |
| **ACME 失敗（80 が閉じている）** | Caddy ログ | SG ルールを事前検証し、欠けていれば中断 |
| **メモリ不足 (OOM) — 特に cargo build 中** | `docker stats` + `dmesg \| grep -i oom` + cargo の異常終了 | 8GB でも落ちる場合は「リレーを一時停止してビルド」する手順を README に記載 |
| **`BUZZ_API_TOKEN` が必要なのに発行できない**（rev 2 の新規リスク） | `buzz-acp` が認証エラーで接続不可 | 発行経路が存在しない可能性がある（§1.1）。まず `BUZZ_ALLOW_NIP_OA_AUTH=true` による Nostr 署名認証で通るかを確認し、駄目なら `BUZZ_REQUIRE_AUTH_TOKEN=false` に落とす。**その場合はセキュリティ上の妥協であることを README に明記する**（黙って緩めない） |
| **Claude サブスクリプション OAuth が使えない** | `claude-agent-acp` の起動失敗 / 認証エラー | `ANTHROPIC_API_KEY` にフォールバックし、**どちらで通ったかを出力とドキュメントに残す** |
| **イメージ / フレーバー不在** | `conoha image list` / `conoha flavor list` の照会失敗 | 仮定せず中断 |

フォールバックは自動で行うが、**成功したように見せかけない**。どの経路で終わったかが最終出力に残る（本リポジトリ CLAUDE.md の「失敗は silent → loud」原則）。特に `BUZZ_REQUIRE_AUTH_TOKEN=false` への降格は**セキュリティ設定の緩和**であり、絶対に黙って行わない。

## 7. 検証 / 完了条件

すべて `2>&1 | tee -a <ログ>` で**ターミナル原文をキャプチャ**する。要約・言い換えは証拠として認めない。

`verify.sh` は **VM 内で実行する部分**と**ローカルから実行する部分**に分かれる。ローカル側から叩くことで「外部からアクセスできる」ことまで含めて証明する（VM 内の `127.0.0.1` だけでは SG / Caddy / ACME の検証にならない）。

| # | 項目 | 実行場所 | 合格条件 |
|---|---|---|---|
| 1 | リレー生存 | VM | `docker compose exec relay` 経由の `/_liveness` が `200 OK` |
| 2 | Web UI 配信 | ローカル | `curl -fsSI https://<fqdn>/` が `200` かつ `content-type: text/html` |
| 3 | WebSocket | ローカル | `wss://<fqdn>` へのアップグレードが `101 Switching Protocols` |
| 4 | オーナー登録 | VM | `buzz-admin list-members` にオーナー pubkey が出る |
| 5 | **エージェント登録** | VM | `buzz-admin list-members` に**エージェント pubkey も**出る |
| 6 | **ハーネス常駐** | VM | `systemctl is-active buzz-acp` が `active`、ログに relay 接続成功 |
| 7 | **エージェント応答** | ローカル | チャンネルで `@agent` にメンションし、**応答メッセージが返る**（スクリーンショット 1 枚 + `buzz-cli` での取得ログ） |
| 8 | 使用メモリ実測 | VM | `docker stats` + `free -h` のスナップショット（8GB 妥当性の根拠） |
| 9 | 後始末 | ローカル | `down.sh` 実行後、`conoha server list` / ボリューム一覧ともに残存 0 件 |

**項目 7 が本サンプルの中核**である。ここが通らなければ rev 2 の目的（§1 の 4）を達成していない。

> ⚠️ **上流 README の検証スニペットをそのまま使ってはいけない。** 上流は
> `curl -fsS "http://127.0.0.1:$BUZZ_HTTP_PORT/_liveness"` を案内するが、TLS モードでは
> `compose.caddy.yml` の `ports: !reset []` によりホストに公開されるリレーポートが無くなる（§1.1）。
> さらに `_liveness` はヘルスポート 8080 側であり、3000 にも同じパスがあるかは未確認（§8）。
> `verify.sh` は**両方の経路を試し、どちらで通ったかを出力する**設計とする。

## 8. 未確認事項（実装時に潰す）

いずれも「仮定」であり、断定しない。実装フェーズで実機確認し、結果を PR に記す。

**リレー基盤（rev 1 から継続）**

1. `_liveness` がリレーの 3000 番にも存在するか（8080 のみか）。→ `verify.sh` が両経路を試すことで実測に置き換える。
2. `conoha` CLI v0.8.0 で `server ssh --insecure` が実動作するか。→ 依存しない設計にしているため、結果に関わらずブロッカーにはならない。
3. `buzz-admin generate-key` が DB 接続なしで動くか。→ 動かない場合は Postgres 起動後に実行する順序へ組み替える。
4. `sslip.io` の LE クォータに現在余裕があるか。→ 実行時にしか分からないため §6 のフォールバックで吸収する。
5. `ubuntu-26.04` が現在もカタログにあるか。→ `conoha image list` で照会してから使う。
6. リレーが実際に `/` で Web UI を返すか。→ `Dockerfile` の ENV 設定という強い根拠はあるが、実行確認は未了。完了条件 2 で確定する。
7. `TYPESENSE_API_KEY` が `.env.example` にあるが `compose.yml` に typesense サービスが無い。無害な残骸と推測されるが未確認のため、値は生成しておく。

**エージェント連携（rev 2 で追加）**

8. **`BUZZ_API_TOKEN` の取得経路が存在するか。** 上流 README の `mint-token` は実在しない（§1.1）。`BUZZ_REQUIRE_AUTH_TOKEN=true` のままエージェントが接続できるか、Nostr 署名認証（`BUZZ_ALLOW_NIP_OA_AUTH`）で足りるかを実測する。**rev 2 で最大のブロッカー候補。**
9. **Claude のサブスクリプション OAuth で `claude-agent-acp` が動くか。** 上流は API キーのみを文書化しており、OAuth の記述は無い。§5.1 手順 5 で実測する。
10. **`g2l-t-c6m8` (8GB) で cargo build が完走するか。** リレー 5 コンテナ常駐下での並行ビルド。完了条件 8 で実測する。
11. **エージェントをチャンネルに招待する方法。** 上流が *"The relay doesn't yet have a REST/event API for managing channel members — this is a known gap"* と認める既知のギャップ。Web UI 経由が有力だが未確認。
12. **`buzz-acp` のビルド所要時間。** README の手順時間見積りに必要。実測する。
13. 上流ドキュメントの陳腐化が `mint-token` 以外にも及んでいるか。→ 手順は README ではなく**ソースと `--help` を正**として実装する。

## 9. 将来の拡張（本 PR では扱わない）

- 複数エージェントの常駐（`BUZZ_ACP_AGENTS` / 個別鍵）とロール分担。
- YAML ワークフロー（メッセージ / リアクション / スケジュール / webhook トリガ）。
- git ホスティング（NIP-34 パッチ、`branch as room`）。
- 自前ドメイン + A レコードでの運用（LE レート制限を根本回避）。
- デスクトップアプリ（Tauri）からの接続手順。
- `deploy/charts` を使った Kubernetes デプロイ。

## 10. 参考

- [block/buzz](https://github.com/block/buzz) — 上流リポジトリ
- `deploy/compose/README.md` — 上流の VPS デプロイ手順
- `crates/buzz-acp/README.md` — ACP ハーネス（**`mint-token` の記述は陳腐化。§1.1 参照**）
- [agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) — Claude 用 ACP アダプタ
- `ARCHITECTURE.md` / `NOSTR.md` / `VISION_AGENT.md` — 上流の設計文書
- `docs/postmortems/2026-05-14-slurm-rest-api-gpu-worker.md` — `sslip.io` の LE レート制限（G5）
- 本リポジトリ README「自分のアプリをデプロイするには」— `conoha.yml` を置かない例外パターンの規定
