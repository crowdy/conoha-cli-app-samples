# Buzz セルフホスト サンプル — 設計

- **日付:** 2026-07-24
- **対象サンプル:** `buzz/`
- **想定フレーバー:** `g2l-t-c6m8` (6 vCPU / 8GB)。リレー 5 コンテナに加えて **VM 上で Rust ビルドを行う**ため（§3.1）
- **上流:** [block/buzz](https://github.com/block/buzz) — Rust / Apache-2.0
- **ステータス:** Design rev.3 (実装前 / spec-reviewer 指摘反映済み)

## 0. 改訂履歴

| rev | 日付 | 変更 |
|---|---|---|
| 1 | 2026-07-24 | 初版。AI エージェント連携と `buzz-cli` を非目標とし、リレー + Web UI のみを対象とした |
| 2 | 2026-07-24 | AI エージェント連携を目標に格上げ（利用者判断）。`buzz-acp`/`buzz-cli` の VM 上ビルド追加、4GB → 8GB、上流ドキュメント陳腐化を記載 |
| **3** | **2026-07-24** | **spec-reviewer の指摘を反映。最大の変更は「ブラウザで使える」という rev 1〜2 の前提が誤りだったこと**（§0.1）。人間側クライアントを `buzz` CLI に確定。危険なフォールバック 1 件を削除、サイレント無応答を招く設定漏れ 1 件を修正、その他 12 件を反映 |

### 0.1 rev 2 の誤りと訂正（重要）

rev 1〜2 の §1.1 は次を**断定形**で記していた:

> イメージは Web UI を同梱し、既定で `/` に配信する → **ブラウザだけで利用でき、デスクトップアプリは必須ではない。**

**これは誤りである。** 根拠として挙げた `ENV BUZZ_WEB_DIR` は実在するが、そこから「チャット UI が配信される」という結論は導けない。観測ではなく推論を事実として記述していた。実測による反証:

| 検証 | 結果 |
|---|---|
| `web/src/features/` | `invite` と `repos` の **2 つだけ**。チャット/チャンネル/メッセージは無い |
| `desktop/src/features/` | `chat` `channels` `messages` `agents` `huddle` … — **チャット UI はデスクトップアプリ専用** |
| `crates/buzz-relay/src/router.rs:63` | `/` は `nip11_or_ws_handler` に明示ルーティング（SPA ではない） |
| `router.rs:467`（上流自身の単体テスト） | `assert!(!should_serve_spa("/", false));` — 既定で `/` は SPA を返さない |
| `router.rs:469` | フラグを有効化しても出るのは **git リポジトリブラウザ** |

したがって既定状態でブラウザが `/` に GET すると **NIP-11 JSON** が返る。

**訂正の帰結**: 人間側クライアントを **`buzz` CLI に確定**する（§1 目的 3、§7）。エージェント常駐のために `buzz` はどのみちビルドするので追加コストは無い。デスクトップアプリは参考情報に降格する。

## 1. 背景と目的

[Buzz](https://github.com/block/buzz) は Block, Inc. が公開した、**人間と AI エージェントが同じ部屋で作業する** セルフホスト型ワークスペースである。実体は Nostr リレーで、メッセージ・リアクション・ワークフロー・レビュー承認・git イベントのすべてが「署名済みイベント」として 1 本のログに載る。署名者が人間かプロセスかで扱いが変わらない点が中核の設計思想であり、**エージェントが「ボット」ではなく鍵を持つ一員として参加する**ことがこのプロダクトの主張そのものである。

本サンプルの目的は、**ConoHa VPS 1 台の上に Buzz リレーを立ち上げ、AI エージェントを 1 体そこに常駐させ、`@mention` に応答することを実測で示す**こと。`conoha-cli-app-samples` には Nostr / 分散プロトコル系のサンプルが無く、「LLM エージェントをインフラとして常駐させる」サンプルも無いため、両方の入口となる。

このサンプルが提供するもの：

1. `conoha` CLI で CPU VM を 1 台作り、Docker Compose で Buzz スタック（relay + Postgres + Redis + MinIO + Caddy）を起動する。
2. 外部 DNS を用意せずに **HTTPS/WSS で外部から到達できる**（`sslip.io` ワイルドカード DNS + Let's Encrypt）。
3. **`buzz` CLI を人間側クライアントとして**、オーナー鍵でチャンネルにメッセージを投稿し、応答を回収する。
4. **AI エージェント（Claude）を独自の Nostr 鍵を持つ参加者として常駐させ、`@mention` に応答することを、偽陰性対照付きで実証する**（§7）。
5. 使い終わったら 1 コマンドで全リソースを破棄する（ブートボリュームを含む）。

**非目標 (Out of Scope):**

- 本番運用（バックアップ・監視・HA・マルチコミュニティ）。上流の `deploy/charts`（Kubernetes）は対象外。
- **デスクトップアプリ（Tauri）の導入手順**。チャット GUI が必要な場合の入口として README に参考リンクを置くのみで、完了条件には含めない。
- ブラウザによるチャット利用（§0.1 のとおり**現状の上流に存在しない**）。`BUZZ_SERVE_GIT_WEB_GUI` による git ブラウザも扱わない。
- 複数エージェントの同時常駐、ワークフロー（YAML 自動化）、git ホスティング機能、huddle。エージェントは **1 体**に限る。
- 自前ドメイン + DNS A レコードの取得手順。

### 1.1 前提となる事実（調査済み・2026-07-24 時点）

出典を併記する。**推論には「推論」と明記し、観測と混ぜない。**

#### リレー基盤

- **上流リポジトリ**: Rust / Apache-2.0。★数と最終 push は同日中にも動く（レビュー時点で ★8,318 / 09:28Z、初回調査時 ★7,652 / 06:21Z）。→ **日次で動く上流であり、ref 固定が不可欠**（§3）。
  出典: `gh api repos/block/buzz`（2 時点で実行）
- **VPS 向けデプロイ束が公式に存在する**: `deploy/compose/`。上流 README は *"This is the single-node/VPS deployment bundle."* と明記。
  出典: `deploy/compose/README.md`
- **公式イメージはプリビルド・マルチアーキ**: `ghcr.io/block/buzz:main` は `linux/amd64` と `linux/arm64` を持つ。**リレー起動に Rust ビルドは不要。**
  出典: `docker manifest inspect ghcr.io/block/buzz:main`
- **イメージに入るバイナリは 3 つだけ**: `buzz-relay` / `buzz-admin` / `buzz-pair-relay`。
  出典: `Dockerfile:67-69`, `Dockerfile:138-140`
- **⚠️ バンドルされた Web にチャット UI は無い**: `web/src/features/` は `invite` と `repos` のみ。`/` は `nip11_or_ws_handler` に明示ルーティングされ、SPA フォールバックに到達しない（`router.rs:256` のコメント *"`/` is an explicit relay route, so it never reaches the SPA fallback."*）。SPA が出るのは `should_serve_spa()` が真のときだけで、`/` は `BUZZ_SERVE_GIT_WEB_GUI=true` の場合に限られ、その中身は **git リポジトリブラウザ**である。上流自身の単体テストが `assert!(!should_serve_spa("/", false));` と固定している。**チャットは `desktop/` 専用。**
  出典: `crates/buzz-relay/src/router.rs:63,207-213,256,467-469`, `web/src/features/`, `desktop/src/features/`
- **`buzz-admin` のサブコマンド**: `AddMember` / `RemoveMember` / `ListMembers` / `GenerateKey` / `Migrate` / `ProductFeedback` / `ReconcileChannels`。
  出典: `crates/buzz-admin/src/main.rs:42-96`
- **`generate-key` は DB を要さないが、`add-member`/`list-members` は要する**: `GenerateKey` は `Keys::generate()` のみ。メンバー系は DB + Redis + `BUZZ_RELAY_PRIVATE_KEY` を要求する。→ **メンバー操作は必ず `run.sh start` 後に `docker compose exec relay` 経由で行う。**
  出典: `crates/buzz-admin/src/main.rs`（`cmd_add_member` → `connect_member_services`）
- **REST 認証は NIP-98 署名であり、API トークン検証は実装されていない**: `verify_bridge_auth` は NIP-98 を検証する。`BUZZ_REQUIRE_AUTH_TOKEN=false` が有効化するのは**トークン省略ではなく `X-Pubkey` ヘッダによる開発用の身元詐称経路**である。
  出典: `crates/buzz-relay/src/api/bridge.rs:111`（NIP-98）, `:117-119`（`// Dev-mode fallback: X-Pubkey header (only when require_auth_token is false)`）
- **既定は「閉じたリレー」**: `BUZZ_REQUIRE_AUTH_TOKEN=true` / `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true` / `BUZZ_ALLOW_NIP_OA_AUTH=true`（**これは既に既定値**）/ `RELAY_OWNER_PUBKEY=CHANGE_ME_OWNER_PUBKEY_HEX`。
  出典: `deploy/compose/.env.example`
- **Host ヘッダでコミュニティを解決し、未マッピングなら 404**: コミュニティは起動時に `RELAY_URL` の authority からのみ播種される。→ **ドメインを変えるなら `RELAY_URL` を含む派生 5 変数を同時に作り直さないと全面 404 または別コミュニティ分裂になる**（§6）。
  出典: `crates/buzz-relay/src/router.rs:271-294`（`"relay: no community is configured for this host"`）, `crates/buzz-relay/src/main.rs:222-263`
- **TLS モードではホストに公開されるリレーポートが無くなる**: `compose.caddy.yml` が `relay.ports: !reset []` で解除する。
  出典: `deploy/compose/compose.yml`, `deploy/compose/compose.caddy.yml`
- **`/_liveness` は 3000 と 8080 の両方に登録されている**: ランタイムイメージには `curl` も入っている（`compose.yml` の "no curl/wget" コメントは陳腐化）。
  出典: `crates/buzz-relay/src/router.rs:68,227`, `Dockerfile:128-132`
- **`EXPOSE 3000 8080 9102` / `ENTRYPOINT ["/usr/local/bin/buzz-relay"]`**（ファイル全 156 行）。
  出典: `Dockerfile:151,156`
- **ワイルドカード DNS は現時点で解決する**: `sslip.io` / `nip.io` / `traefik.me` いずれも正引き可能。
  出典: `getent hosts`（2026-07-24 実行）
- **`sslip.io` は LE の weekly rate limit に当たった実績がある**: `HTTP 429 rateLimited - too many certificates (250000) already issued for "sslip.io" in the last 168h`。
  出典: `docs/postmortems/2026-05-14-slurm-rest-api-gpu-worker.md:61-69`
- **Compose の最低版数**: 上流は *"Requires Docker Compose v2.24.4 or newer; the TLS override uses Compose's `!reset` tag"* と明記。
  出典: `deploy/compose/README.md:29-31`
- **フレーバー名**: `g2l-t-c6m8` = 6 vCPU / 8GB（`-t-` は時間課金）。`g2l-t-4` のような名前は存在しない。**DISK 列は `0`（ブートボリューム別建て）なので実ディスク余裕は実行時にしか分からない。**
  出典: `conoha flavor list`（2026-07-24 実行）

#### エージェント連携

- **`buzz-acp` はプリビルドが無く cargo ビルドが必要**: リレーイメージにも最新リリース `v0.4.24` の成果物（デスクトップ用 5 点）にも含まれない。
  出典: `crates/buzz-acp/README.md:22-24`, `Dockerfile:67-69`, `gh api repos/block/buzz/releases/latest`
- **`buzz-cli` も必要。ただし成果物のバイナリ名は `buzz`**: `crates/buzz-cli/Cargo.toml` が `[[bin]] name = "buzz"` を宣言する。エージェントに注入されるシステムプロンプトも一貫して `buzz` を呼ぶ（`buzz messages send` など）。→ **`target/release/buzz-cli` は存在しない。**
  出典: `crates/buzz-cli/Cargo.toml`, `crates/buzz-acp/src/base_prompt.md`, `crates/buzz-acp/README.md:3-8,23,56`
- **⚠️ 著者ゲートの既定は `owner-only` で、拒否は「無言の破棄」**: *"Events from disallowed authors are **silently dropped** before reaching subscription rules."* / *"The default mode is `owner-only`. **Agents without a registered `agent_owner_pubkey` will not respond to any events** until the owner is resolved."* コード側も `assert_eq!(RespondTo::default(), RespondTo::OwnerOnly)` で固定。`agent_owner_pubkey` は NIP-OA auth tag の署名検証時にのみ生成され、**`buzz-admin add-member` では作られない**。
  → **`BUZZ_ACP_RESPOND_TO` を明示しないと、他が全て正常でも `@mention` に無反応になる**（§5.1, §6, §7）。
  出典: `crates/buzz-acp/README.md:125,129,136,153`, `crates/buzz-acp/src/config.rs:2270`
- **チャンネル参加は CLI 経由が上流の推奨**: *"The relay doesn't yet have a REST/event API for managing channel members — this is a known gap. For now, use `create_channel` via the Buzz CLI to create new channels (the creator is automatically a member)."*
  出典: `crates/buzz-acp/README.md:44`
- **Claude 連携は npm アダプタ経由**: `npm install -g @agentclientprotocol/claude-agent-acp` + `BUZZ_ACP_AGENT_COMMAND="claude-agent-acp"`。→ **VM に Node.js/npm も必要**。旧名 `claude-code-acp` も可。
  出典: `crates/buzz-acp/README.md:74-90`
- **⚠️ 上流が文書化している Claude 認証は API キーのみ**: `export ANTHROPIC_API_KEY="sk-ant-..."` と記される。ACP README 全体を `oauth|subscription|login` で検索すると 3 行が一致するが、**いずれもサブスクリプション OAuth を支持しない**（うち 1 行は Codex 項の *"required — use an OpenAI API key, not a ChatGPT subscription"* で、むしろ明示的に排除している）。
  → 「Claude Pro/Max のサブスクリプション OAuth で動く」は**上流ドキュメントの裏付けが無い [仮定]**。実測で確定させる（§5.2・§8）。
  出典: `crates/buzz-acp/README.md:67,72,80-84,125`
- **⚠️ 上流ドキュメントが陳腐化している**: ACP README は `buzz-admin mint-token` を案内するが、`buzz-admin` に `mint-token` は無い（ソースの `mint|token` 一致 0 件、`mint-token` の出現は文書 2 ファイルのみ）。**上流 README ではなくソースと `--help` を正とする。**
  出典: `command grep -niE "mint|token" crates/buzz-admin/src/main.rs`（出力 0 行）, `gh api "search/code?q=repo:block/buzz+mint-token"`（文書 2 件のみ）
- **Rust ビルドには C ツールチェーンが要る**: 上流ビルダーは Rust ビルド前に `build-essential` / `pkg-config` / `libssl-dev` / `ca-certificates` / `git` を導入する。`rust-toolchain.toml` は `channel = "1.95.0"` 固定（"stable" 指定は実効しない）。依存は `Cargo.lock` で 964 パッケージ、`aws-lc-sys`（`cmake` を使うビルドスクリプト）を含む。
  出典: `Dockerfile:56-58`, `rust-toolchain.toml`, `Cargo.lock`
- **`sha-<7>` イメージタグは main への push で発行される**: `relay-v*` タグのみが semver 発行を行い、デスクトップの `v*` タグはこのイメージを発行しない。→ **`v0.4.24` に対応する `sha-` タグは存在しない**（GHCR タグ照会で確認済み）。
  出典: `.github/workflows/docker.yml:11-20`, GHCR タグ一覧照会

## 2. アーキテクチャ概要

```
  [ローカル PC]                       [ConoHa VPS  g2l-t-c6m8 / Ubuntu]
   conoha CLI ── server create ──────▶ 公開 IPv4
       |                                    |
       |  scripts/up.sh (SSH 越しに実行)     v
       └────────────────────────────▶ ┌─────────────────────────────────┐
                                      │ git fetch block/buzz @ 固定SHA  │
                                      │ deploy/compose/  (上流そのまま) │
                                      │   + .env  ← bootstrap-env.sh    │
                                      └───────────────┬─────────────────┘
                                                      │ BUZZ_COMPOSE_TLS=true ./run.sh start
                                                      v
                                                caddy :80/:443
                                                      │  (Let's Encrypt / reverse_proxy)
                                                      v
                                                 relay :3000
                                            (WebSocket + REST。Host→community 解決)
                                                      │
                        ┌─────────────────────────────┼──────────────┬──────────────┐
                        v                             v              v              │
                   postgres:17                     redis:7        minio             │
                (イベント + FTS 検索)              (pub/sub)   (メディア)            │
                                                                                    │
        人間 ── wss://<fqdn> ──▶ buzz CLI (オーナー鍵)  ──────────────────────────────┤
                                 messages send / thread                             │
                                                                                    │
                                      ┌─────────────────────────────────────────────┘
                                      v
                        ┌───────────────────────────────────────────┐
                        │ buzz-acp  (systemd, ホスト上のプロセス)    │
                        │   ├ 自身の Nostr 鍵 = エージェントの身元   │
                        │   ├ 著者ゲート: RESPOND_TO=allowlist       │
                        │   └ stdio ─▶ claude-agent-acp (npm)       │
                        │                  └─▶ Claude (OAuth/APIキー)│
                        │      応答は `buzz` CLI 経由で relay へ書き戻し│
                        └───────────────────────────────────────────┘
```

**設計上の要点:**

- `conoha proxy`（blue/green）は**使わない**。Caddy が 80/443 を直接握るため。本リポジトリ README が認めている例外パターン（`vllm-gpu`・`personal-dashboard`・`dokploy`・`vcluster` と同じ扱い）に該当し、`conoha.yml` は置かない。
- **人間側クライアントは `buzz` CLI**（§0.1）。ブラウザはチャットに使えない。
- 上流の `deploy/compose/` には一切パッチを当てない。差分は `.env` の生成と、フォールバック時の `Caddyfile` 差し替えに限定する。
- **`buzz-acp` はコンテナ化せず、ホスト上の systemd サービスとして動かす。** 上流がイメージを提供しておらず、独自 Dockerfile を書くと上流の変更に追従できなくなるため。

## 3. ファイル構成（ハイブリッド方式）

```
buzz/
├── README.md              # 日本語。手順 / 注意点 / トラブルシュート / 参考
├── .gitignore             # .secrets/ を除外
├── scripts/
│   ├── up.sh              # VM 作成 → Docker → fetch → bootstrap → 起動
│   ├── bootstrap-env.sh   # VM 内で .env を生成
│   ├── agent-up.sh        # ツールチェーン → ビルド → 鍵 → systemd 登録
│   ├── verify.sh          # 完了条件の再実行（証拠キャプチャ用・偽陰性対照含む）
│   └── down.sh            # 全リソース破棄（ブートボリューム含む）
└── .buzz-ref              # 上流の完全コミット SHA とイメージタグ
```

`.secrets/`（ローカル、`0700`）にオーナー鍵を保管する。git には入れない（§4）。

**なぜ「上流を固定 SHA で取得し、オーバーレイだけ持つ」のか:**

- 上流 `deploy/compose/` は上流自身が保守・検証している VPS 向け束であり、コピーすると即座に古いフォークになる。
- ref を固定しないと再現できず、本リポジトリの「完了報告には再実行結果を含める」規約を満たせない。
- `buzz-acp` を**ソースからビルドする**以上、ハーネスとリレーイメージが同一コミット由来でなければプロトコル整合が保証されない。

### 3.1 `.buzz-ref` の決め方と機械的検証

**手順（イメージ起点。逆順にすると解けない）:**

1. GHCR で `ghcr.io/block/buzz` の `sha-<7>` タグを 1 つ選ぶ（`:main` の現在値でよい）。
2. その 7 桁を完全コミット SHA に展開し、`BUZZ_GIT_REF` に**完全 SHA で**記録する。
3. `BUZZ_IMAGE` に `ghcr.io/block/buzz:sha-<7>` を記録する。

```sh
# 上流の完全コミット SHA と、それを発行元とするイメージタグ。
# 必ず「イメージタグ → コミット SHA」の順に決めること（§3.1）。
BUZZ_GIT_REF=<40桁の完全コミット SHA>
BUZZ_IMAGE=ghcr.io/block/buzz:sha-<上と同じコミットの先頭7桁>
```

> **最新リリース tag から選んではいけない。** `.github/workflows/docker.yml:11-20` のとおり、イメージを発行するのは main への push と `relay-v*` タグだけで、デスクトップの `v*` タグ（`v0.4.24` 等）は発行しない。実際 `v0.4.24` に対応する `sha-` タグは GHCR に存在しない。

**取得方法**: `git clone --branch` は**コミット SHA を受け付けない**ため、次を使う:

```sh
git init && git remote add origin https://github.com/block/buzz.git
git fetch --depth 1 origin "$BUZZ_GIT_REF" && git checkout FETCH_HEAD
```

**一致は人間の規律ではなく機械で担保する**: `verify.sh` が、作業ツリーの `git rev-parse --short=7 HEAD` と `BUZZ_IMAGE` の `sha-` 接尾辞を比較し、不一致なら失敗させる（§7 項目 0）。

### 3.2 なぜ 8GB フレーバーなのか

`buzz-acp` と `buzz`（CLI）を VM 上で `cargo build --release` するため。依存は 964 パッケージで、`aws-lc-sys` などビルドスクリプトが C コンパイラを回すクレートを含む。4GB ではリレー 5 コンテナ常駐下での並行ビルドが OOM に至るリスクが高い。`-t-` は時間課金であり、サンプル実行中のみ課金される。

フレーバーの DISK 列は `0`（ブートボリューム別建て）なので、**ビルド前に `df -h /` と `free -h` を必ずキャプチャ**して実測値を残す（§7 項目 8）。

## 4. `bootstrap-env.sh` が生成する `.env`

`bootstrap-env.sh` は **VM 内で実行**し、**公開 IPv4 と DNS サフィックスを引数で受け取る**（`bootstrap-env.sh <ipv4> <sslip.io|nip.io>`）。VM 側で IP を再検出しない（メタデータサービス依存を避ける）。ドメイン派生 5 変数は**必ずこの 1 か所でまとめて生成**する（§6 のフォールバックが安全に成立する前提）。

`buzz-admin` を呼ぶ際は **ENTRYPOINT の上書きが必要**（`Dockerfile:156` が `buzz-relay` に固定）。スタック起動前は `docker run --rm --entrypoint buzz-admin $BUZZ_IMAGE generate-key`、起動後は `docker compose exec relay buzz-admin <cmd>`。**`add-member` / `list-members` は DB + Redis + リレー鍵を要するため、必ず `run.sh start` 後**に実行する（§1.1）。

| 分類 | 変数 | 生成方法 |
|---|---|---|
| ドメイン連動 | `BUZZ_DOMAIN` | `<ip-dashes>.<サフィックス>` |
| | `RELAY_URL` | `wss://<BUZZ_DOMAIN>` ← **コミュニティ同一性の根拠。§6 参照** |
| | `BUZZ_MEDIA_BASE_URL` | `https://<BUZZ_DOMAIN>/media` |
| | `BUZZ_MEDIA_SERVER_DOMAIN` | `<BUZZ_DOMAIN>` |
| | `BUZZ_CORS_ORIGINS` | `https://<BUZZ_DOMAIN>` |
| ランダム秘密 | `BUZZ_GIT_HOOK_HMAC_SECRET` | `openssl rand -hex 32` |
| | `POSTGRES_PASSWORD` / `REDIS_PASSWORD` | `openssl rand -hex 32` |
| | `TYPESENSE_API_KEY` | `openssl rand -hex 32` |
| | `BUZZ_S3_ACCESS_KEY` / `BUZZ_S3_SECRET_KEY` | `openssl rand -hex 32` |
| Nostr 鍵 | `BUZZ_RELAY_PRIVATE_KEY` | `buzz-admin generate-key`（リレー自身の署名鍵） |
| | `RELAY_OWNER_PUBKEY` | `buzz-admin generate-key`（**オーナー用に別途生成**。公開鍵のみ） |
| 固定 | `BUZZ_IMAGE` | `.buzz-ref` から |
| | `BUZZ_AUTO_MIGRATE` | `true`（新規 DB のため） |
| | `BUZZ_REQUIRE_AUTH_TOKEN` | **`true` のまま変更しない**（§6） |

**オーナー秘密鍵の扱い（重要 / rev 3 で変更）:**

rev 2 は「標準出力に 1 回だけ表示して保存しない」としていたが、それでは完了条件 3・4（オーナー鍵での投稿）が再実行できず、かつ `tee` で捕捉すると秘密鍵がログに平文で残る（本リポジトリには `gitleaks` ワークフローがある）。

**rev 3 の方針**: オーナー秘密鍵は**運用者のローカルワークステーションに保管し、サーバには置かない**（Nostr の設計思想と一致する）。

- `up.sh` がローカルの `buzz/.secrets/owner.nsec`（`0600`、`.gitignore` 済み）に書き出す。
- **キャプチャログには公開鍵のみを出力**し、秘密鍵は出力しない。§7 の証拠規約に「秘密鍵は捕捉対象外とし、その旨をログに残す」という例外を明記する。
- `verify.sh` のローカル側は `.secrets/owner.nsec` を読んで `buzz` CLI を実行する。

## 5. 実行フロー

### 5.0 リレー構築（`scripts/up.sh`）

```
 1. keypair / セキュリティグループ作成
 2. SG ルール: ingress tcp 22（管理）, 80（ACME HTTP-01）, 443（サービス）
 3. VM 作成    conoha server create --flavor g2l-t-c6m8 --image <検出値>
                 --key-name --security-group --no-input --yes --wait
 4. 公開 IPv4 抽出（★これがローカル側の「正本」。§7 の期待値はここから導く）
 5. SSH 準備   ssh-keygen -R <ip> ; ssh-keyscan -H <ip> >> ~/.ssh/known_hosts
 6. Docker 導入 (get.docker.com) → docker compose version をキャプチャ（≥ v2.24.4 必須）
 7. 上流取得    git init / fetch --depth 1 <完全SHA> / checkout FETCH_HEAD （§3.1）
 8. .env 生成   bootstrap-env.sh <公開IPv4> sslip.io
 9. 起動        BUZZ_COMPOSE_TLS=true ./run.sh start
10. 検証        verify.sh（リレー部分）
```

**手順 3-5 は本リポジトリで蓄積された罠の回避である:**

- `--no-input` と `--yes` は別フラグ。検証済み先例（`vcluster/scripts/00-provision.sh:23-24`）に合わせて両方指定する。
- `conoha server show --format json` の `addresses` は**ネットワーク名をキーとする dict**。配列インデックスで取ると壊れる。`version == 4` で選ぶ。
- `conoha server ssh --insecure` は CLI v0.7.1 で実動作しなかった記録がある。**バージョンに依存しない `ssh-keyscan` 事前シードに依拠**し、この不確実性を設計から外す。
- イメージ名は決め打ちせず `conoha image list` で確認する。無ければ即座に失敗させる。

### 5.1 エージェント常駐（`scripts/agent-up.sh`）

```
 1. ビルド依存導入   apt-get install -y build-essential pkg-config libssl-dev \
                        cmake ca-certificates git        （出典 Dockerfile:56-58 + aws-lc-sys 対応）
                     rustup（rust-toolchain.toml が 1.95.0 を固定）+ Node.js LTS + npm
                     df -h / と free -h をキャプチャ
 2. ハーネスのビルド cargo build --release -p buzz-acp -p buzz-cli
                     install -m755 target/release/buzz-acp target/release/buzz /usr/local/bin/
                     ★ 成果物名は `buzz`。`buzz-cli` というファイルは生成されない（§1.1）
 3. ACP アダプタ導入 npm install -g @agentclientprotocol/claude-agent-acp
 4. エージェント身元 buzz-admin generate-key                → agent 鍵ペア（出力を正本として保存）
                     buzz-admin add-member --pubkey <agent_pub> --role member
                     （※ スタック起動後に docker compose exec 経由。§1.1）
 5. Claude 認証     5-a. まずサブスクリプション OAuth を試す（§5.2）
                    5-b. 失敗したら ANTHROPIC_API_KEY にフォールバック
                    いずれで通ったかを必ず記録する（§6）
 6. systemd 登録    buzz-acp を Restart=on-failure で常駐化。環境:
                      BUZZ_PRIVATE_KEY=<agent_nsec>
                      BUZZ_RELAY_URL=wss://<BUZZ_DOMAIN>
                      BUZZ_ACP_AGENT_COMMAND=claude-agent-acp
                      BUZZ_ACP_SUBSCRIBE=mentions
                      BUZZ_ACP_RESPOND_TO=allowlist              ★必須
                      BUZZ_ACP_RESPOND_TO_ALLOWLIST=<オーナー公開鍵hex>  ★必須
 7. チャンネル用意   エージェント鍵で buzz channels create（作成者は自動的にメンバー）
                     → オーナーが join。上流が推奨する唯一の実動線（§1.1）
```

**手順 6 の ★ が無いと何が起きるか**: 著者ゲートの既定は `owner-only` で、`agent_owner_pubkey` は `add-member` では作られない。結果として**すべてのイベントが無言で破棄され**、完了条件 1〜7 が緑のまま `@mention` だけ無反応になる（§1.1・§6・§7）。`allowlist` は公開鍵一致だけで通るため、完全開放の `anyone` より安全である。

**手順 7 の根拠**: 上流は *"The relay doesn't yet have a REST/event API for managing channel members — this is a known gap"* と認めており、CLI でチャンネルを作る経路（作成者が自動メンバー）が唯一の実動線である。ブラウザ UI にチャンネル作成画面は**存在しない**（§0.1）。

### 5.2 サブスクリプション OAuth をどう VM に持ち込むか

**新規 VM にはログイン済みの Claude 資格情報が存在しない。** サブスクリプション OAuth を試す以上、資格情報を VM 側に用意する手段が要る。

| 案 | 内容 | 評価 |
|---|---|---|
| **O-1（第一候補）** | VM 上で対話的にログインする。`ssh -t` で PTY を確保し、表示された URL をローカルのブラウザで開いてコードを貼り戻す | 資格情報をファイルとして持ち出さない。**完全自動化はできず、人手の介在点が 1 つ入る** |
| O-2 | ローカルの資格情報ファイルを VM へコピー | **採らない。** サブスクリプション認証情報をサーバへ複製することになり、規約・セキュリティの両面で不適切 |
| O-3 | `ANTHROPIC_API_KEY` を使う | §5.1 手順 5-b のフォールバック |

**方針**: O-1 を試し、駄目なら O-3。**O-2 は採用しない。** `agent-up.sh` は O-1 の対話ステップで一旦停止し、利用者に操作を促す（黙って O-3 に落ちない）。

結論が「サブスクリプション OAuth では動かない」であっても失敗ではない。**上流ドキュメントに無い事項を実測で確定させた記録**として README と PR に残すこと自体が成果である。`claude-agent-acp` がどの認証経路を実装しているかは未確認（§8）であり、実装時はアダプタ側のドキュメントを一次情報として確認してから着手する。

## 6. 失敗処理 — silent → loud

| 失敗 | 検出方法 | 処理 |
|---|---|---|
| **`sslip.io` の LE レート制限 (429)** — 実績あり | `docker compose logs caddy` に `rateLimited` / `429` | **原子的な再ブートストラップのみ許可**（部分修正は禁止）: `run.sh stop` → `docker compose … down -v`（新規構築なのでデータ損失なし）→ `bootstrap-env.sh <ip> nip.io` で**ドメイン派生 5 変数を同時に再生成** → 再起動。それでも失敗なら `Caddyfile` に `tls internal`。**どの経路で通ったかを `verify.sh` の出力に必ず残す** |
| **ドメイン変更後の 404 / 別コミュニティ分裂** | 応答本文に `relay: no community is configured for this host`（上流固定文言） | `verify.sh` が即失敗。`BUZZ_DOMAIN` だけ変えて `RELAY_URL` を放置した典型パターン（§1.1） |
| **エージェントが `@mention` に無反応** | `journalctl -u buzz-acp` の破棄ログ + `BUZZ_ACP_RESPOND_TO` の実効値 | `verify.sh` が**起動前に**ゲート設定を断言し、未設定なら中断（§5.1 手順 6） |
| **閉じたリレーで入室できない** | `list-members` にオーナーが居ない | 異常終了 |
| **ACME 失敗（80 が閉じている）** | Caddy ログ | SG ルールを事前検証し、欠けていれば中断 |
| **ビルド失敗（依存不足 / OOM / ディスク）** | cargo の異常終了 + `dmesg \| grep -i oom` + `df -h` | 依存は §5.1 手順 1 で先回り。OOM ならリレー停止後に再ビルドする手順を README に記載 |
| **Claude サブスクリプション OAuth が使えない** | `claude-agent-acp` の起動失敗 / 認証エラー | `ANTHROPIC_API_KEY` にフォールバックし、**どちらで通ったかを記録** |
| **イメージ / フレーバー不在** | `conoha image list` / `conoha flavor list` の照会失敗 | 仮定せず中断 |

**`BUZZ_REQUIRE_AUTH_TOKEN=false` へのフォールバックは行わない（rev 3 で削除）。** 理由: (1) リレーに API トークン検証は実装されておらず、認証は NIP-98 なので**トークン不足という問題自体が存在しない**。(2) このフラグを false にすると `X-Pubkey` ヘッダによる**任意の身元詐称**が公開エンドポイントで可能になる（`bridge.rs:117-119`）。安全側の費用は実質ゼロ、誤判の費用は公開されたなりすまし経路であり、非対称が極端である。401/403 が出た場合の原因はメンバーシップかコミュニティ束縛（Host / `RELAY_URL` 不一致）であり、そちらを調べる。

**フォールバックを `.env` に固着させない**: フォールバックが発動した実行は、その事実を結果に残したうえで、次回実行では再び 1 段目から試す。

## 7. 検証 / 完了条件

すべて `2>&1 | tee -a <ログ>` で**ターミナル原文をキャプチャ**する。要約・言い換えは証拠として認めない。**ただし秘密鍵はキャプチャ対象外**とし、除外した事実をログに残す（§4）。

**期待値の正本（循環参照の禁止）**: 検証の期待値を、検証対象が生成した成果物から取ってはならない。

- FQDN は `.env` からではなく、**§5.0 手順 4 でローカルが取得した IPv4** から再導出する。
- オーナー/エージェントの公開鍵は `.env` や systemd ユニットからではなく、**`generate-key` の出力を捕捉したログ**を正本とする。

| # | 項目 | 実行場所 | 合格条件 |
|---|---|---|---|
| 0 | **イメージ↔ソース同一性** | VM | `git rev-parse --short=7 HEAD` == `BUZZ_IMAGE` の `sha-` 接尾辞（§3.1） |
| 1 | リレー生存 | VM | `/_liveness` が `200 OK`（3000・8080 の両方に存在。§1.1） |
| 2 | 外部到達性 | ローカル | `https://<fqdn>/` が **NIP-11 JSON を返す**（`content-type: application/json`）。※ これは「チャットが使える」ことを意味しない（§0.1） |
| 3 | WSS + 認証 | ローカル | `wss://<fqdn>` へ接続し、**NIP-42 認証まで成功**する。※ `101` だけでは不十分 — アップグレードは認証の**前**に起きるため、全イベントを拒否するリレーでも `101` を返す |
| 4 | オーナー登録 | VM | `buzz-admin list-members` にオーナー pubkey（正本ログと一致） |
| 5 | エージェント登録 | VM | `buzz-admin list-members` にエージェント pubkey（正本ログと一致） |
| 6 | ハーネス常駐 + ゲート | VM | `systemctl is-active buzz-acp` が `active`、**かつ `BUZZ_ACP_RESPOND_TO` の実効値が `allowlist`**、破棄カウンタのログを併記 |
| 7 | **エージェント応答（中核）** | ローカル | オーナー鍵で `buzz messages send --channel <uuid> --content "@<agent> reply with token DEADBEEF"` → **N 秒以内**に `buzz messages thread …` の JSON に `DEADBEEF` が含まれる |
| 7-N | **偽陰性対照（必須）** | ローカル | 項目 7 の**前に** 1 回、`@mention` を含まない本文（または `BUZZ_ACP_RESPOND_TO=nobody`）で同じスクリプトを実行し、**必ず失敗すること**を確認する |
| 8 | 資源実測 | VM | ビルド前後の `df -h /` `free -h` `docker stats` スナップショット（8GB 妥当性とビルド所要時間の根拠） |
| 9 | 後始末 | ローカル | `down.sh` 実行後、`conoha server list` / ボリューム一覧ともに残存 0 件 |

**項目 7 が本サンプルの中核**であり、**7-N を通さずに 7 を根拠にしてはならない**（本リポジトリ CLAUDE.md の「検証命令自体を陰性対照で先に検証する」規約）。トークン文字列とタイムアウトを条件に含めるのは、「応答らしきもの」と「実際にプロンプトを読んだ応答」を区別するためである。

> ⚠️ **上流 README の検証スニペットをそのまま使ってはいけない。** 上流は `curl -fsS "http://127.0.0.1:$BUZZ_HTTP_PORT/_liveness"` を案内するが、TLS モードでは `ports: !reset []` によりホストに公開されるリレーポートが無い（§1.1）。`docker compose exec` 経由で叩く。
>
> ⚠️ **`tls internal` にフォールバックした場合**、項目 2・3 は証明書検証を通らない。`curl -k` / WSS クライアント側の検証無効化に切り替え、**「自己署名経路だった」ことを出力に明記**する（検証コマンド自体が変わる点を隠さない）。

## 8. 未確認事項

### 8.1 rev 2 で「未確認」としていたが、ソースで解消したもの

| rev 2 の項目 | 結論 | 根拠 |
|---|---|---|
| `_liveness` は 3000 にもあるか | **ある**（3000・8080 両方） | `router.rs:68,227` |
| `generate-key` は DB を要するか | **要さない**。ただし `add-member`/`list-members` は要する | `buzz-admin/src/main.rs`（`connect_member_services`） |
| `BUZZ_API_TOKEN` の取得経路（rev 2 の「最大ブロッカー」） | **問題自体が存在しない**。REST 認証は NIP-98 で、トークン検証は未実装。`mint-token` 文書は単なる陳腐化 | `api/bridge.rs:111,117-119`, `buzz-cli/src/client.rs`, `buzz-acp/src/relay.rs` |
| リレーは `/` で Web UI を返すか | **返さない**（NIP-11 JSON）。§0.1 で設計ごと訂正 | `router.rs:63,207-213,467-469` |

### 8.2 実機でしか確定できない仮定（実装フェーズで潰す）

1. `ubuntu-26.04` が現在もカタログにあるか → `conoha image list` で照会してから使う。
2. `sslip.io` の LE クォータに現在余裕があるか → §6 のフォールバックで吸収する。
3. `g2l-t-c6m8` (8GB) で 964 パッケージのリリースビルドが完走するか（メモリ・**ディスク**・所要時間）→ 完了条件 8 で実測。
4. **Claude のサブスクリプション OAuth で `claude-agent-acp` が動くか** → §5.2 で実測。上流は API キーのみを文書化している。
5. `claude-agent-acp`（npm・上流リポジトリ外）が実装している認証経路 → パッケージ側ドキュメントを一次情報として確認する。
6. NIP-42 認証後、エージェント鍵が実際にイベントを投稿できるか（メンバーシップゲート通過）→ 完了条件 5・7。
7. GHCR の `sha-` タグ保持ポリシー。タグが消えるとサンプルが静かに再現不能になる → §9 の定期確認で扱う。
8. `conoha` CLI v0.8.0 で `server ssh --insecure` が実動作するか → **依存しない設計**にしているためブロッカーにはならない。
9. `TYPESENSE_API_KEY` は `.env.example` にあるが `compose.yml` に typesense サービスが無い。無害な残骸と**推測**（未確認）。値は生成しておく。

## 9. 将来の拡張（本 PR では扱わない）

- `.buzz-ref` の `sha-<7>` タグが GHCR に存在し続けるかを週次で確認するワークフロー（本リポジトリには `line-api-mock-openapi-drift.yml` という同型の先例がある）。
- 複数エージェントの常駐（`BUZZ_ACP_AGENTS` / 個別鍵）とロール分担。
- YAML ワークフロー、git ホスティング（NIP-34）、huddle。
- 自前ドメイン + A レコードでの運用（LE レート制限を根本回避）。
- デスクトップアプリ（Tauri）からの接続手順 — チャット GUI が要る場合の唯一の経路。
- `deploy/charts` を使った Kubernetes デプロイ。

## 10. 参考

- [block/buzz](https://github.com/block/buzz) — 上流リポジトリ
- `deploy/compose/README.md` — 上流の VPS デプロイ手順
- `crates/buzz-acp/README.md` — ACP ハーネス（**`mint-token` の記述は陳腐化。§1.1 参照**）
- `crates/buzz-relay/src/router.rs` — ルーティングと SPA 配信条件（§0.1 の根拠）
- [agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) — Claude 用 ACP アダプタ
- `ARCHITECTURE.md` / `NOSTR.md` / `VISION_AGENT.md` — 上流の設計文書
- `docs/postmortems/2026-05-14-slurm-rest-api-gpu-worker.md` — `sslip.io` の LE レート制限（G5）
- 本リポジトリ README「自分のアプリをデプロイするには」— `conoha.yml` を置かない例外パターンの規定
