# buzz — ConoHa VPS 上で Buzz（人間 + AI エージェント協働ワークスペース）をセルフホスト

[Buzz](https://github.com/block/buzz)（Block, Inc. / Apache-2.0）は、**人間と AI エージェントが同じ部屋（Nostr リレー）で作業する**セルフホスト型ワークスペースです。メッセージも git イベントもワークフローも、すべて署名済み Nostr イベントとして 1 本のログに載り、署名者が人間かプロセスかで扱いが変わりません。

このサンプルは、ConoHa VPS 1 台に Buzz リレーを立て、**Claude エージェントを独自の Nostr 鍵を持つ参加者として常駐**させ、`buzz` CLI からの `@mention` に応答するところまでを**実測で**示します（2026-07-25 に ConoHa 実機で全工程を検証済み）。

> **重要:** バンドルされる Web にチャット UI はありません（`/` は NIP-11 JSON を返す Nostr リレーのエンドポイント）。**人間側の操作は `buzz` CLI** で行います。チャット GUI が要る場合は上流のデスクトップアプリ（Tauri、プリビルドあり）を使ってください（「デスクトップ GUI」節）。

![ConoHa VPS 上のセルフホスト Buzz にデスクトップアプリで接続した様子（左下 `133-117-74-17` が自前リレー、`demo` チャンネルにエージェントが常駐）](https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/main/buzz/docs/screenshot.png)

## 構成

- **リレースタック**（Docker Compose, 上流 `deploy/compose/`）: `relay`（Rust）+ `postgres` + `redis` + `minio` + `caddy`。
- **TLS**: Caddy が `<ip-dashes>.sslip.io` + Let's Encrypt で 80/443 を直接終端します（`conoha proxy` 不使用 = `conoha.yml` なし）。実機で LE 証明書取得と外部 HTTPS 到達を確認済み。
- **エージェント**: ホスト上の systemd サービス `buzz-acp`。`buzz-acp` が `claude-agent-acp`（ACP アダプタ）を spawn し、それが `claude`（Claude Code）を駆動します。エージェントは独自の Nostr 鍵を持つメンバーです。
- **上流ピン**: `deploy/compose/` を固定コミット SHA（`.buzz-ref`）で取得し、**パッチしません**。差分は `.env` 生成とホスト側スクリプトだけです。

## 推奨フレーバー

- **`g2l-t-c6m8`（6 vCPU / 8GB, 時間課金）**。VM 上で `buzz-acp`/`buzz`（Rust）をビルドするため 8GB を推奨。
  - 実測（2026-07-25, sha-ab3af82）: cargo ビルド **約 2 分**、稼働中メモリ使用 **約 1.1 GiB / 7.7 GiB**（relay 37M / caddy 29M / postgres 66M / redis 4M / minio 88M）、ディスク約 14 GB。運用だけなら軽いが、ビルドに余裕が要る。
- フレーバー名・イメージ名は時期により異なります。`conoha flavor list` / `conoha image list` で確認してください（本サンプルは `vmi-ubuntu-26.04-amd64` を既定）。

## 前提

- `conoha` CLI セットアップ済み（v0.8.0 で確認）。**ConoHa に登録済みの SSH キーペア**（`conoha keypair list` で名前を確認し `KEY_NAME` に渡す）。対応する秘密鍵が手元にあること（`conoha server ssh` が自動検出する）。
- 手元に `git` / `bash` / `python3` / `openssl` / `curl`。
- Claude 認証（**サブスクリプション OAuth もしくは `ANTHROPIC_API_KEY`**）。詳細は「エージェントの認証」節。
- SSH(22)/HTTP(80, ACME)/HTTPS(443) を開ける（`up.sh` が SG を作成）。

## クイックスタート

```bash
cd buzz
bash scripts/selftest.sh                       # ① ローカル検証（課金なし・静的検査込み）
KEY_NAME=<登録済みキー名> ./scripts/up.sh       # ② VM 作成 + リレー起動（課金開始）
./scripts/verify.sh                            # ③ リレー完了条件（0-4）
# ④ Claude 認証（サブスクリプション）: VM で一度だけ
conoha server ssh buzz-sample                  #    VM に入り
#   claude setup-token                         #    → sk-ant-oat... を控える
#   printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' 'sk-ant-oat...' >> /root/.buzz-agent.env   （agent-up 後）
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat... ./scripts/agent-up.sh   # ⑤ ビルド→鍵→systemd→チャンネル
./scripts/verify.sh --agent                    # ⑥ 偽陰性対照 → @mention 応答（中核）
./scripts/down.sh                              # ⑦ 全破棄（必ず実行 — 時間課金）
```

> `agent-up.sh` は `CLAUDE_CODE_OAUTH_TOKEN`（O-1）または `ANTHROPIC_API_KEY`（O-3）を環境変数で受け取り、VM の root-only env に配置します。どちらも渡さない場合は systemd を用意した上で「トークンを追記して `systemctl restart buzz-acp`」する手順を表示します（silent に無認証で進めません）。

## エージェントの認証（重要 / spec §5.2）

- **O-1 サブスクリプション OAuth（既定）**: VM 上で `claude setup-token` を実行すると、ブラウザ承認後に**長寿命トークン**（`sk-ant-oat...`）が出力されます。これを `CLAUDE_CODE_OAUTH_TOKEN` として systemd の env（`/root/.buzz-agent.env`）に置きます。
  - **なぜトークンが要るか（実測 2026-07-25）**: 対話的 `claude login`/`setup-token` で作られる資格はログインセッションにのみ存在し、**systemd から起動する `buzz-acp` → `claude-agent-acp` → `claude` からは見えません**（`claude auth status` は対話シェルでは `loggedIn:true` でも、systemd 環境では `false`）。そのため `CLAUDE_CODE_OAUTH_TOKEN` を明示的に env へ渡す必要があります。
  - トークンの取り違えに注意: ブラウザ側に出る**認証コード**ではなく、`setup-token` が**最後に出力するトークン**（`sk-ant-oat...`）を使います。誤った値だと `claude auth status` は `loggedIn:true` に見えても、実 API 呼び出しが `401 Invalid bearer token` になります。`claude -p "reply READY"` が `READY` を返せば有効です。
- **O-3 フォールバック**: `ANTHROPIC_API_KEY=... ./scripts/agent-up.sh`（console.anthropic.com のキー。API 従量課金）。

## 仕組みの要点（実測で確定した事項）

- `buzz-admin generate-key` の出力は bech32 ではなく **`Public key: <64hex>` / `Secret key: <64hex>`**。`BUZZ_PRIVATE_KEY` には hex 秘密鍵をそのまま使えます。
- `buzz` CLI は**既定で JSON を stdout に出力**します（`--format` フラグは無し）。`channels create` は `{"channel_id":...}`、`messages get` は `[{"pubkey":...,"content":...,"id":...}]`。
- エージェントへの `@mention` は、エージェントのプロフィール表示名（`buzz users set-profile --name agent`）で解決されます。本サンプルはエージェント名を `agent` に設定するので、オーナーは `@agent ...` で呼べます。
- リレーの `/` は `Accept: application/nostr+json` に対し **content-type `application/json`** で NIP-11 relay info を返します（`supported_nips` に 42 を含む＝NIP-42 認証必須の閉リレー）。
- 著者ゲートは `BUZZ_ACP_RESPOND_TO=allowlist`（オーナー pubkey を allowlist に）。既定 `owner-only` は `BUZZ_ACP_AGENT_OWNER` 未設定だと無言破棄になるため、本サンプルは allowlist + owner を明示。
- `buzz-acp` の `--agent-command` 既定は `goose`。Claude では `BUZZ_ACP_AGENT_COMMAND=claude-agent-acp` かつ `BUZZ_ACP_AGENT_ARGS=`（空。goose 用の `acp` を上書き）。
- オーナー秘密鍵の正本は**ローカル `.secrets/owner.nsec`**（ログに出さない）。既定経路ではテスト送信のため使い捨て VM の root-only env に一時配置し、`down.sh` で VM ごと破棄します（spec §4.0 からの意図的逸脱。厳密順守はローカル `buzz` ビルド）。

## デスクトップ GUI（任意）で使う

`buzz` CLI の代わりに GUI で使いたい場合は、上流のデスクトップアプリ（Tauri）を使います。**ビルド不要** — [GitHub Releases](https://github.com/block/buzz/releases) に各 OS のプリビルドがあります（Windows は `Buzz_<ver>_x64-setup_alpha-unsigned.exe`。未署名 alpha のため SmartScreen は「詳細情報 → 実行」で回避。Tauri なので WebView2 ランタイムが要る）。

1. **identity key**: 「use existing key」を選び、このリレーのオーナー鍵を入れます。オーナー鍵は hex 保存なので nsec(bech32) に変換して貼り付けます（`buzz/` で）:

   ```bash
   python3 scripts/hex2nsec.py "$(cat .secrets/owner.nsec)"   # nsec1... を出力（NIP-19 ベクタで検証済み）
   ```

   これでオーナー（リレー所有者・`demo` チャンネル参加・エージェント allowlist）として GUI にログインでき、GUI から `@agent` に話せます。**オーナー鍵はマスター鍵。共有しないこと。**
2. **"Set up your agent harnesses" 画面**は、この PC 上でローカルにエージェントを動かすためのものです。エージェントは VM 上で常駐しているので **「Skip for now」で構いません**。
3. **community / relay の追加**: リレー URL `wss://<ip-dashes>.sslip.io`（`.secrets/fqdn` の値）を登録すると `demo` チャンネルが見えます。

> オーナー鍵を GUI に置きたくなければ、GUI で新規 identity を作り、その npub を `buzz-admin add-member` でメンバー登録 + systemd の `BUZZ_ACP_RESPOND_TO_ALLOWLIST` に追加 + `buzz channels join` すれば、その鍵でも `@agent` が応答します（オーナー鍵はサーバ/ローカルだけに残す）。

## トラブルシュート

- **`/` が JSON を返す**: 正常です。チャットは `buzz` CLI かデスクトップアプリで。
- **`up.sh` が SSH 疎通で 5 分ループして失敗する**: 初回起動直後は sshd 未応答で `ssh-keyscan` が空を返し、`conoha server ssh` の host-key 検証に失敗します。本サンプルの `up.sh` は keyscan を疎通ループ内で毎回試行して回避済み。
- **Docker 導入で `Could not get lock`（apt）**: 初回起動の cloud-init/unattended-upgrades が apt ロックを保持するため。`up.sh` は `cloud-init status --wait` の後に Docker を導入して回避済み。
- **relay が unhealthy で crash（`BUZZ_GIT_PACK_CACHE_PATH ... Permission denied`）**: 上流イメージは `/data/git` を持たず、Docker が `buzz-git-data` ボリュームを root 所有で作るため、relay（uid 1000 `buzz`）が git pack cache を作れません。`up.sh` はボリュームを `1000:1000` に chown してから起動して回避済み（上流を patch しない）。
- **エージェントが `401 Invalid bearer token` / `Authentication required`**: 「エージェントの認証」節を参照。`CLAUDE_CODE_OAUTH_TOKEN`（`sk-ant-oat...`）が `/root/.buzz-agent.env` に正しく入っているか、`claude -p "reply READY"` が通るかを確認し、`systemctl restart buzz-acp`。
- **Let's Encrypt 429（`docker compose logs caddy`）**: `sslip.io` は共有ドメインで LE 週次上限に当たることがあります。VM 上で原子的に再ブートストラップしてドメインだけ差し替えます（秘密・鍵は保存されます）:

  ```bash
  IP=$(conoha server show buzz-sample --format json | python3 -c 'import sys,json;d=json.load(sys.stdin);print([a["addr"] for n in d["addresses"].values() for a in n if a.get("version")==4 and not a["addr"].startswith(("10.","127.","192.168."))][0])')
  OWNER_PUB=$(cat buzz/.secrets/owner.pub)
  conoha server ssh buzz-sample -- "cd /opt/buzz/deploy/compose && docker compose down && \
    BUZZ_IMAGE=$(sed -n 's/^BUZZ_IMAGE=//p' buzz/.buzz-ref) \
    bash /opt/buzz/scripts-bootstrap-env.sh .env.example .env $IP nip.io $OWNER_PUB && \
    docker run --rm -v buzz-prod_buzz-git-data:/data/git alpine chown 1000:1000 /data/git && \
    BUZZ_COMPOSE_TLS=true ./run.sh start"
  # ローカル正本も nip.io に更新（さもないと verify.sh が旧 sslip.io を叩く）
  printf '%s' "$(echo "$IP" | tr '.' '-').nip.io" > buzz/.secrets/fqdn
  ```

  それでも駄目なら `Caddyfile` を `tls internal` にし、`verify.sh` は `CURL_K=-k ./scripts/verify.sh` で自己署名経路を明示します。
- **エージェントが無反応**: `journalctl -u buzz-acp`。`BUZZ_ACP_RESPOND_TO=allowlist` と allowlist にオーナー pubkey が入っているか、エージェントがチャンネルのメンバーか（`buzz channels members --channel <id>`）を確認。
- **デスクトップアプリで community 追加時に `Failed to fetch`**: CORS です。アプリ（Tauri webview）の origin が relay の `BUZZ_CORS_ORIGINS` に無いと、NIP-11 の fetch がブラウザ側でブロックされます。`bootstrap-env.sh` は Tauri の標準 origin（`https://tauri.localhost` / `http://tauri.localhost` / `tauri://localhost`）を既定で許可済み。別 origin のクライアントを使う場合は VM の `.env` の `BUZZ_CORS_ORIGINS` に追記して `systemctl` ではなく `./run.sh restart` で relay を再起動してください。**`*` は不可**（relay の CORS 層が panic します）— origin を明示列挙します。

## 参考

- [block/buzz](https://github.com/block/buzz) — 上流
- `deploy/compose/README.md`（上流）
- [claude-agent-acp](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp) — ACP アダプタ
- [Claude Code](https://github.com/anthropics/claude-code) — `claude` CLI（`setup-token`）
