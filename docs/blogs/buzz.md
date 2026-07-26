---
title: conoha-cli で ConoHa VPS に「人間 + AI エージェント協働ワークスペース」Buzz をセルフホストし、Claude を常駐エージェントとして @mention に応答させる
tags: ConoHa conoha-cli Nostr Claude AIエージェント
author: crowdy
slide: false
---
## はじめに

[Buzz](https://github.com/block/buzz)（Block, Inc. / Apache-2.0）は、**人間と AI エージェントが同じ部屋で作業する**セルフホスト型ワークスペースです。実体は Nostr リレーで、メッセージもリアクションも git イベントもワークフローも、すべて「署名済み Nostr イベント」として 1 本のログに載ります。**署名者が人間かプロセスかで扱いが変わらない**——つまりエージェントが「ボット」ではなく**鍵を持つ一員**として参加する、という設計思想がこのプロダクトの核です。

本記事では、**ConoHa VPS 1 台**に conoha-cli で Buzz リレーを立て、**Claude エージェントを独自の Nostr 鍵で常駐**させ、`buzz` CLI からの `@mention` に応答するところまでを **実機で** 検証します（2026-07-25〜26, ConoHa 実機）。最後に **Windows のデスクトップ GUI** から自前リレーに接続する手順も示します。GPU は不要、フレーバーは **`g2l-t-c6m8`（6 vCPU / 8GB）** です（VM 上で Rust をビルドするため 8GB を推奨）。

![ConoHa VPS 上のセルフホスト Buzz にデスクトップアプリで接続した様子（左下 `133-117-74-17` が自前リレー）](https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/main/buzz/docs/screenshot.png)

---

## 最初にハマった誤解: 「ブラウザだけで使える」は誤り

調べ始めた当初、「イメージに Web が同梱されているのだからブラウザで使えるだろう」と考えました。**これは誤りでした。**

- バンドルされる Web（`web/`）の機能は `invite` と `repos` の 2 つだけ。**チャット UI はデスクトップアプリ（Tauri）専用**です。
- リレーの `/` は NIP-11（リレー情報 JSON）を返すエンドポイントで、SPA フォールバックには到達しません（上流の単体テストが `assert!(!should_serve_spa("/", false))` で固定）。

したがって人間側のクライアントは **`buzz` CLI** か **デスクトップアプリ**になります。ブラウザに `https://<relay>/` を叩くと、次のような NIP-11 が返ります（`supported_nips` に **42**＝認証必須が入っている点に注目）。

```json
{"name":"Buzz Relay","software":"https://github.com/block/buzz","version":"0.2.0",
 "supported_nips":[1,2,10,11,16,17,23,25,29,33,38,42,50,56,43],
 "limitation":{"auth_required":true,"restricted_writes":true}}
```

**教訓**: 「同梱物がある」ことと「その機能が有効」は別。推論を観測と混ぜず、実物（`web/src/features/`、`router.rs`）を見て確定すべきでした。

---

## なぜ `conoha app deploy` ではなく `server create` + `server ssh` なのか

このシリーズの多くのサンプルは `conoha app deploy` ワンコマンドで完結します（`compose.yml` を VPS に転送して `docker compose up`）。しかし Buzz サンプルは **`conoha.yml` を持たず**、scripts 主体にしています。理由は 2 つです。

1. **TLS を Caddy が直接終端する**。外部 DNS を用意せず HTTPS/WSS で到達させるため、`<ip-dashes>.sslip.io`（ワイルドカード DNS）+ Let's Encrypt を Caddy が 80/443 で直接握ります。`conoha proxy`（blue/green プロキシ）と 80/443 を奪い合うので `conoha.yml` は置きません。
2. **エージェントの常駐 + 鍵生成 + systemd 登録**が VPS 上の手続き的な作業で、ファイル転送モデルと噛み合いません。

構成は以下の通りです。

```
[ローカル PC]  conoha CLI (v0.8.0)
   │  up.sh: server create / security-group / server ssh
   ▼
[ConoHa VPS  g2l-t-c6m8 / ubuntu-26.04]
   ├─ Docker Compose: relay(Rust) + postgres + redis + minio + caddy
   │     └─ Caddy が sslip.io + Let's Encrypt で 80/443 を終端（conoha.yml なし）
   └─ systemd: buzz-acp → claude-agent-acp → claude（Claude Code / OAuth）
                    ▲ 独自の Nostr 鍵を持つ「メンバー」として常駐
[人間側クライアント]  buzz CLI  /  デスクトップアプリ（Tauri, プリビルド）
```

---

## 動かす手順

```bash
cd buzz
bash scripts/selftest.sh                       # ① ローカル検証（課金なし・shellcheck 込み）
KEY_NAME=<登録済みキー名> ./scripts/up.sh       # ② VM 作成 + リレー起動（課金開始）
./scripts/verify.sh                            # ③ リレー完了条件（image==source / liveness / NIP-11 / owner 登録）
# ④ Claude 認証（サブスクリプション）: VM で一度だけ
#    conoha server ssh buzz-sample → claude setup-token → sk-ant-oat... を控える
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat... ./scripts/agent-up.sh   # ⑤ ビルド→鍵→systemd→チャンネル
./scripts/verify.sh --agent                    # ⑥ 偽陰性対照 → @mention 応答（中核）
./scripts/down.sh                              # ⑦ 全破棄（必ず実行 — 時間課金）
```

`up.sh` は「登録済みキーペアの再利用」「セキュリティグループ 22/80/443 の生成と存在検証」「上流を固定コミット SHA で取得（`.buzz-ref`）」「`.env` の冪等生成」「TLS 起動」までを 1 コマンドで行います。`agent-up.sh` は VM 上で `buzz-acp`/`buzz`（Rust）をビルドし、エージェント鍵の生成・メンバー登録・systemd 常駐・デモチャンネル作成までを行います。

---

## 中核の実証: エージェントが `@mention` に応答する

オーナー鍵で `@agent` 宛にメッセージを送ると、Claude エージェントが**自分の鍵で署名した Nostr イベント**として応答します。`verify.sh --agent` は「**偽陰性対照 → 本検証**」の順で判定します。

- **偽陰性対照（7-N）**: `@mention` を含まない本文を送る → `subscribe=mentions` により配信されず、エージェントは応答しない（応答が来たら検出器か mention フィルタが壊れている）。実測: 70 秒待って無応答＝OK。
- **本検証（7）**: `@agent …トークン…` を送る → エージェント作成（`pubkey == AGENT_PUB`）の投稿に当該トークンが含まれることを確認。実測: 約 8 秒で応答。

実際に GUI/CLI から自己紹介を求めた際の応答（一部）です。閉じたリレー越しに、Claude が「一員」として日本語で返しています。

```
[you]   @agent 自己紹介して。何ができる？
[agent] はじめまして。この「demo」チャンネルで動いている Buzz プラットフォーム上のエージェントです。
        できること（buzz CLI 経由）: メッセージの送受信・検索、チャンネル管理、コードの調査・実装・
        PR 作成、ワークフローのトリガー、他のエージェントの作成（下書き）… 役割や優先事項を
        教えてもらえれば core memory に記録します。
```

CLI から話しかけるには（`@agent` を必ず含めるのがポイント。含まないと mention フィルタで配信されません）:

```bash
set -a; . /root/.buzz-owner.env; set +a
CH=$(cat /root/... または buzz/.secrets/channel)
buzz messages send --channel $CH --content "@agent 今日のタスクを3つ提案して"
buzz messages get  --channel $CH --limit 20   # 既定で JSON 配列を返す
```

---

## デスクトップ GUI から自前リレーに接続する（ビルド不要）

チャット GUI は上流のデスクトップアプリ（Tauri）です。**ローカルビルドは不要**——[GitHub Releases](https://github.com/block/buzz/releases) に各 OS のプリビルドがあり、Windows は `Buzz_<ver>_x64-setup_alpha-unsigned.exe` を入れるだけです（未署名 alpha なので SmartScreen は「詳細情報 → 実行」で回避）。

1. **identity key**: 「use existing key」を選び、リレーのオーナー鍵（`nsec`）を入力。本サンプルはオーナー鍵を hex で保持するので、同梱の `scripts/hex2nsec.py`（NIP-19 で検証済み）で変換します。
2. **agent harnesses 画面**: これは「この PC 上でローカルにエージェントを動かす」ための設定。エージェントは VM に常駐しているので **Skip for now** で OK。
3. **community 追加**: リレー URL `wss://<ip-dashes>.sslip.io` を登録すると `demo` チャンネルが見え、GUI からも `@agent` に話せます（冒頭のスクリーンショット。左下の `133-117-74-17` が自前リレー）。

---

## 実際にハマった点（実測ログから）

上流は日次で動く活発なプロジェクトで、ドキュメントより実物が先行します。固定コミット SHA（`sha-ab3af82`, relay `v0.2.0`）で検証する過程で踏んだ落とし穴を、同じことをする方のために残します。

### 1. 初回起動の SSH は `ssh-keyscan` を「疎通ループ内」で回す

`conoha server ssh` は host-key を厳格に検証します。新規 VM は起動直後 sshd が応答しないため、**ループ外で 1 回だけ** `ssh-keyscan` すると空を掴み、`~/.ssh/known_hosts` が空のまま 5 分間ずっと `Host key verification failed` になります。keyscan を**リトライループの中**で毎回試すのが正解です。

### 2. 初回起動は cloud-init が apt ロックを保持している

`get.docker.com` の `apt-get update` が `Could not get lock` で即死しました。first-boot の cloud-init/unattended-upgrades が dpkg/apt ロックを持っているためです。**`cloud-init status --wait`** を挟んでから apt を触ります。

### 3. relay が `pack-cache … Permission denied` で crash する（ボリューム所有権）

上流イメージには `/data/git` が無いため、Docker は `buzz-git-data` という named volume を **root 所有**で作ります。relay は非 root ユーザ（uid 1000 `buzz`）で動くので git pack cache を作れず crash-loop します。上流を patch せず、**起動前にボリュームを chown** して回避しました。

```bash
docker run --rm -v buzz-prod_buzz-git-data:/data/git alpine chown 1000:1000 /data/git
```

### 4. `buzz-admin generate-key` の出力は bech32 ではなくラベル + hex

`nsec1…` を期待して grep すると空振りします。実出力は次の形式で、`BUZZ_PRIVATE_KEY` には **hex 秘密鍵**をそのまま使えます。

```
Public key:  <64桁hex>
Secret key:  <64桁hex>
```

### 5. `run.sh restart` は relay しか作り直さない

初回 `up` が relay unhealthy で中断すると caddy が起動しません。`restart`（relay のみ再作成）ではなく **full `start`** で全サービスを healthy まで待つ必要があります。

### 6. 対話ログインの Claude 資格は systemd から見えない → `setup-token`

最大の難所でした。VM で `claude setup-token` / `claude login` してもその資格は**ログインセッションにのみ**存在し、**systemd 起動の `buzz-acp` → `claude-agent-acp` → `claude` からは見えません**（対話シェルでは `claude auth status` が `loggedIn:true` でも、systemd 環境では `false`）。ヘッドレスで OAuth を使うには、`claude setup-token` が出力する**長寿命トークン**（`sk-ant-oat…`）を **`CLAUDE_CODE_OAUTH_TOKEN`** としてサービスの env に置きます。

さらに罠がひとつ: ブラウザ側に出る**認証コード**を貼ってしまうと、`claude auth status` は `loggedIn:true` に見えても API 呼び出しが `401 Invalid bearer token` になります。`setup-token` が**最後に出力するトークン**（`sk-ant-oat…`）が正しく、`claude -p "reply READY"` が `READY` を返せば有効です。

### 7. `buzz-acp` の設定（既定は goose、著者ゲート、mention）

- `BUZZ_ACP_AGENT_COMMAND=claude-agent-acp`（既定は `goose`）、`BUZZ_ACP_AGENT_ARGS=`（**空**。goose 用の既定 `acp` を上書き）。
- 著者ゲートは `BUZZ_ACP_RESPOND_TO=allowlist` + allowlist にオーナー pubkey（既定 `owner-only` は `AGENT_OWNER` 未設定だと無言破棄）。
- `subscribe=mentions` なので、エージェントは**チャンネルのメンバー**である必要があり、`@名前` 解決のため**プロフィール表示名の設定**（`buzz users set-profile --name agent`）が要ります。

### 8. デスクトップアプリの `Failed to fetch` は CORS（`*` は panic する）

GUI で community を追加すると `Failed to fetch`。Tauri webview の origin が relay の `BUZZ_CORS_ORIGINS` に無く、NIP-11 の fetch がブラウザ側で弾かれていました。`BUZZ_CORS_ORIGINS=*` は relay の tower-http CORS 層が **panic** するため使えません。ドメイン + Tauri の各 origin（`https://tauri.localhost` / `http://tauri.localhost` / `tauri://localhost`）を**明示列挙**して解決しました。

---

## まとめ

| 項目 | 内容 |
|------|------|
| **対象** | 人間 + AI エージェント協働ワークスペースを自前で持ちたい開発者 |
| **主なコマンド** | `conoha server create` / `conoha server ssh`（`conoha.yml` なし） |
| **推奨フレーバー** | `g2l-t-c6m8`（6 vCPU / 8GB。VM 上で Rust ビルド） |
| **TLS** | Caddy + `<ip-dashes>.sslip.io` + Let's Encrypt（外部 DNS 不要） |
| **エージェント** | systemd `buzz-acp` → `claude-agent-acp` → Claude（OAuth / `CLAUDE_CODE_OAUTH_TOKEN`） |
| **実測** | cargo ビルド約 2 分、稼働メモリ約 1.1 GiB / 7.7 GiB |
| **検証済みイメージ** | `vmi-ubuntu-26.04-amd64` / relay `sha-ab3af82`（v0.2.0） |
| **クライアント** | `buzz` CLI / デスクトップアプリ（プリビルド、Windows 可） |
| **サンプルリンク** | https://github.com/crowdy/conoha-cli-app-samples/tree/main/buzz |

「エージェントを鍵を持つ一員として常駐させる」という Buzz の主張は、閉じたリレー上で **Claude が `@mention` に署名付きイベントで応答する**ところまで実機で確かめられました。conoha-cli と組み合わせれば、VPS 1 台に「人間と AI が同居するワークスペース」をゼロから立ち上げられます。ぜひ試してみてください。

---

## 参考

- [block/buzz - GitHub](https://github.com/block/buzz) — 上流
- [claude-agent-acp（npm）](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp) — ACP アダプタ
- [Claude Code](https://github.com/anthropics/claude-code) — `claude` CLI（`setup-token`）
- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)
