---
title: conoha-cli で PowerDNS による自前 DNS ホスティング (example.jp 風) を ConoHa3 にデプロイ — `dns-server` サンプルの実機検証で見つけた落とし穴
tags: Conoha conoha-cli PowerDNS DNS Docker
author: crowdy
slide: false
---

## はじめに

[example.jp](https://example.jp/) のように「親ゾーンの下にサブドメインを払い出せる権威 DNS サーバー」をセルフホストするサンプルを書きました。`conoha-cli-app-samples` シリーズの 1 つで、PowerDNS Authoritative + PostgreSQL gpgsql バックエンド + FastAPI 製の管理 API という構成です。

ところがこのサンプル、**ローカル開発機では完結検証ができません**。理由は単純で、`pdns` コンテナが `:53` を直接掴む構成のため、Ubuntu や Fedora 系で標準起動している `systemd-resolved` (これも `:53` のスタブリスナーを掴んでいる) と衝突するからです。CI でも同じです。

なので [PR #95](https://github.com/crowdy/conoha-cli-app-samples/pull/95) のレビューでは「ConoHa3 VPS で実機検証」をマージ条件にしていました。本記事はその検証ログと、その過程で見つけた **サンプル側のバグ 3 件 + conoha-cli 側のバグ 4 件** をどう拾ったかの話です。

最終的には PR #95 はマージ済み、conoha-cli 側の 4 件は [Issue #193-#196](https://github.com/crowdy/conoha-cli/issues/193) として登録済みです。

---

## `dns-server` サンプルの構成

```
                                    Internet
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │ :53/udp,tcp             │ :443                    │
              ▼                         ▼                         │
 ┌─────────────────────┐    ┌──────────────────────┐              │
 │ PowerDNS (host net) │    │ conoha-proxy (HTTPS) │              │
 └────────────┬────────┘    └──────────┬───────────┘              │
              │                         ▼                          │
              │             ┌──────────────────────┐               │
              │             │ FastAPI (:8080)      │               │
              │             │ Bearer token auth    │               │
              │             └──────────┬───────────┘               │
              ▼                        ▼                           │
          ┌────────────────────────────────────┐                   │
          │ PostgreSQL 17 (gpgsql + app schema)│                   │
          └────────────────────────────────────┘                   │
                              └─────────────────────────────────────┘
```

| サービス | 役割 |
|---------|-----|
| `pdns` | PowerDNS Authoritative 4.9。`network_mode: host` で `:53/udp,tcp` を直接占有 |
| `app` | FastAPI 管理 API。`conoha-proxy` 経由で HTTPS 公開 |
| `db` | PostgreSQL 17。PowerDNS gpgsql スキーマ + `app` スキーマを保持 |
| `pdns-init` | 起動時 1 回実行: スキーマ適用 + 親 zone (SOA/NS) 種付け + admin token 生成 |

API は `POST/GET/PUT/DELETE /v1/subdomains` の 4 種で `*.users.example.com` のようなサブドメインを CRUD します。バリデーションは「親ゾーン suffix」「RFC 1035 ラベル」「予約語ブラックリスト (`www`, `api`, `admin`, ...)」「TTL 範囲」「records 数上限」など。

---

## なぜローカルで完結検証できないか

`pdns` を `network_mode: host` で動かすため、ホストの `:53` がそのまま PowerDNS の listener になります。ところが Ubuntu/Fedora の素のホストでは `systemd-resolved` が `127.0.0.53:53` (および環境によっては `0.0.0.0:53`) を掴んでいるため、PowerDNS は起動できません。

検証 1 (SOA 取得) や検証 2-4 (POST/CNAME/DELETE → dig) が `:53` 必須なので、開発機では「コンテナは立つけど DNS 解決パスは確認できない」状態になります。`docker compose -f compose.test.yml` で `127.0.0.1:8080` の API 部分は触れますが、それだけだと「PowerDNS と DB の繋がりが正しく切られているか」が分からない。

そこで「ConoHa3 VPS を 1 台立てて systemd-resolved を黙らせる → サンプルを実機投入する」という流れが必要になります。

```bash
# VPS 上で systemd-resolved の :53 スタブを止める
sudo sed -i 's/^#DNSStubListener=yes/DNSStubListener=no/' /etc/systemd/resolved.conf
sudo systemctl restart systemd-resolved
sudo ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf

# UFW の :53 開放
sudo ufw allow 53/udp && sudo ufw allow 53/tcp
```

これで `:53` が空きます。

---

## Phase 1: 構成の正しさを VPS で検証

検証は 2 段階に分けました。Phase 1 は `compose.test.yml` overlay を使って **構成の正しさだけ** を確認します。`PARENT_ZONE=users.example.com` のままで、レジストラの NS 委任もしません。`dig @<vps-ip> ...` でホスト直撃すれば DNS 階層を介さずに PowerDNS の応答そのものを見られます。

### VPS 作成

```bash
conoha server create \
  --name dns-server-test \
  --flavor 6f3c4747-8471-4a38-902b-4c57ad76d776 \   # g2l-t-c4m4 (4 vCPU / 4GB)
  --image  722c231f-3f61-4e79-a5a6-c70d6c9ea908 \   # vmi-docker-29.2-ubuntu-24.04
  --key-name tkim-cli-test-key \
  --security-group IPv4v6-SSH \
  --security-group IPv4v6-Web \
  --security-group dns-server-sg \                  # 53/udp,tcp を別途 sg で開けた
  --no-input --wait
```

`vmi-docker-*` は ConoHa3 の Docker 同梱 VMI イメージで、`apt install docker` を省ける分セットアップが速いです。

### サンプル投入

```bash
ssh root@<vps-ip>
cd /opt
git clone --branch feat/dns-server-sample https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/dns-server
docker compose -f compose.yml -f compose.test.yml up -d --build
```

ところがここで **最初の落とし穴** にぶつかります。

### 落とし穴 ① — `pdns` コンテナが `:53` をバインドできない

`docker compose ps` を見ると `pdns` だけ `Restarting` で延々ループしている。ログを見ると:

```
pdns-1 | Unable to bind UDP socket to '0.0.0.0:53': Permission denied
pdns-1 | Fatal error: Unable to bind to UDP socket
```

EACCES。`network_mode: host` で systemd-resolved も止めたのに、なぜ `:53` を取れないのか？

調べると犯人は **コンテナ内のユーザーが非 root だった** ことでした。`powerdns/pdns-auth-49` イメージは `USER pdns` でビルドされていて、Docker のデフォルト capabilities (`NET_BIND_SERVICE` を含む) が **`exec` 時に effective set から外れる** ためです。Linux カーネルの仕様で、非 root ユーザーへの切り替え時に capability が「ファイルケーパビリティで明示」「ambient セットに追加」のどちらかでない限り消えます。

`cap_add: [NET_BIND_SERVICE]` を試しても直らない。ambient セットに入らないので。最終的には素直に `user: "0:0"` で root 実行に倒しました。

```yaml
# compose.yml の pdns サービス
pdns:
  image: powerdns/pdns-auth-49:4.9.14
  user: "0:0"
  network_mode: host
  ...
```

`network_mode: host` の時点でコンテナ境界はネットワーク側にはほぼなく、また pdns プロセス以外を expose しないので root 実行でもセキュリティ後退はありません。これは [`fix(dns-server): run pdns as root so :53 bind succeeds`](https://github.com/crowdy/conoha-cli-app-samples/commit/0a3382f) としてコミット済み。

### 検証 1-6 すべて通過

`pdns` が起動したら残りはスムーズでした。

```bash
# 検証 1: SOA
$ dig @127.0.0.1 users.example.com SOA +short
ns1.example.com. admin.example.com. 1 10800 3600 604800 3600

# 検証 2: A レコード POST → dig
$ curl -X POST http://127.0.0.1:8080/v1/subdomains \
    -H "Authorization: Bearer test-admin-token" \
    -d '{"name":"tkim.users.example.com","records":[{"type":"A","value":"203.0.113.42"}]}'
$ sleep 12 && dig @127.0.0.1 tkim.users.example.com A +short
203.0.113.42

# 検証 3: CNAME も同様
# 検証 4: DELETE → NXDOMAIN
$ dig @127.0.0.1 tkim.users.example.com A | grep status
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 61575

# 検証 5: examples/curl.sh end-to-end
$ TOKEN=test-admin-token API=http://127.0.0.1:8080 ./examples/curl.sh
... (POST × 2, GET, PUT, DELETE 全て pass)

# 検証 6: pytest
$ pytest tests/integration/test_dns.py -v
3 passed in 50.58s
```

ここで Phase 1 はクリア。サンプルの compose 構成、PowerDNS と DB の繋がり、API の認証/バリデーション、削除カスケードが全部動いていることを確認できました。

---

## Phase 2: 本番フロー + 実ドメインで検証

Phase 2 では `conoha app init/deploy` を使った本番デプロイフローを通します。`PARENT_ZONE` を本人所有の `users.example.jp` に変えて、レジストラで NS 委任までして、最後は public DNS hierarchy 経由 (`dig` を `@8.8.8.8` で打つ) で解決できるところまで持っていきます。

### `conoha-proxy` で HTTPS 受け口を作る

```bash
# レジストラで先に api.example.jp A 160.251.230.73 を登録しておく
conoha proxy boot --acme-email crowdy@gmail.com dns-server-test
```

これだけで Caddy が起動し、`conoha.yml` の `hosts: [api.example.jp]` に対して Let's Encrypt 証明書を自動発行してくれます。

```bash
$ ls /var/lib/conoha-proxy/certs/.../api.example.jp/
api.example.jp.crt  api.example.jp.key  api.example.jp.json
```

### 環境変数とアプリ起動

```bash
conoha app env set dns-server-test --app-name dns-server \
  PARENT_ZONE=users.example.jp \
  PRIMARY_NS=ns1.example.jp. \
  SOA_EMAIL=admin.example.jp. \
  POSTGRES_PASSWORD=$(openssl rand -hex 16) \
  ENV=prod

conoha app init   dns-server-test --app-name dns-server
conoha app deploy dns-server-test --app-name dns-server
```

### 落とし穴 ② — `POSTGRES_PASSWORD` が `pdns.conf` まで届かない

`conoha app deploy` 直後、`pdns` がまた壊れていました。今度はログがこう。

```
gpgsql Connection failed: FATAL: password authentication failed for user "pdns"
```

DB 側は `POSTGRES_PASSWORD` 環境変数を読んでくれます (compose.yml で `${POSTGRES_PASSWORD:-pdns}` を渡している)。アプリ側の `DATABASE_URL` も同じ。ところが **PowerDNS は `pdns.conf` に env 補間機能を持たない** ので、`gpgsql-password=pdns` というリテラル値が残ったままで認証に失敗します。

README には「`POSTGRES_PASSWORD` を変えたら `pdns/pdns.conf` の `gpgsql-password=` 行も手で書き換えろ」と書いてはいたんですが、これは事故が起きるパターンです。実機検証で踏んだので、PowerDNS 公式イメージの `pdns_server-startup` を読んで「環境変数オーバーライドの仕組みは `PDNS_AUTH_API_KEY` 限定」と確認したうえで、**コマンドライン引数で渡す** 方針にしました。`docker compose` の `command:` ディレクティブは ENV 変数を補間してくれます。

```yaml
pdns:
  image: powerdns/pdns-auth-49:4.9.14
  user: "0:0"
  network_mode: host
  command:
    - "--gpgsql-password=${POSTGRES_PASSWORD:-pdns}"   # ← compose が exec 前に展開
  volumes:
    - ./pdns/pdns.conf:/etc/powerdns/pdns.conf:ro
```

これで `pdns.conf` から「秘密」が消え、`.env` 1 箇所だけ更新すれば全サービス同期されるようになりました。

### 落とし穴 ③ — テストの flakiness (PowerDNS の負キャッシュ)

ついでに `pytest tests/` を VPS 上で全件回したら、**44 件中 1 件だけ flaky** に。`test_dns.py::test_a_record_resolves` が NXDOMAIN を返してくる。単独実行だと通る。

調べると PowerDNS のデフォルト設定が `query-cache-ttl=20s`、`negquery-cache-ttl=60s`。前のテストで一度 NXDOMAIN になった名前は **60 秒間ネガティブキャッシュに乗る** ので、同じテストセッション内で次のテストが「POST して 12 秒待って dig」しても、まだ NXDOMAIN がキャッシュされていてアサート失敗、という race でした。

`test_dns.py` の `PROPAGATE = 12` 固定 sleep が直接の原因ですが、本質は **キャッシュ満了に依存した固定待ち** が悪手です。修正は 2 つ:

1. `pdns.conf` で `query-cache-ttl=10`, `negquery-cache-ttl=10` に短縮 (CRUD ベースの権威 DNS なら短い方が UX に合う)
2. `test_dns.py` を **polling resolver** に変更

```python
# tests/integration/test_dns.py (抜粋)
async def _poll(predicate, timeout=60, interval=0.5):
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        try:
            if (result := predicate()):
                return result
        except Exception:
            pass
        await asyncio.sleep(interval)
    raise TimeoutError(f"poll timed out after {timeout}s")

class TestDnsResolution:
    async def test_a_record_resolves(self, client, auth_headers):
        await client.post("/v1/subdomains", ..., json={"name": TKIM, ...})
        ans = await _poll(lambda: _resolver().resolve(TKIM, "A"))
        assert {r.to_text() for r in ans} == {"203.0.113.42"}
```

ついでに `PARENT_ZONE` を環境変数化したので、`PARENT_ZONE=users.example.jp pytest tests/integration/` のような実ドメイン直撃も可能になりました。

### 仕上げ: NS 委任して public hierarchy 経由で解決

レジストラで以下を登録します。

```
users.example.jp.    NS    ns1.example.jp.
users.example.jp.    NS    ns2.example.jp.
ns1.example.jp.      A     160.251.230.73
ns2.example.jp.      A     160.251.230.73
```

`v1` サンプルは単一 VPS 構成で本物の secondary NS は持っていません。レジストラ側で「最低 2 つの NS が必要」と弾かれるので、便宜的に同じ IP で `ns2` も登録しています。本番運用では別 VPS に PowerDNS slave を立てて AXFR/NOTIFY で同期するのが本筋です。

伝播後に試すと:

```bash
$ curl -X POST https://api.example.jp/v1/subdomains \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d '{"name":"tkim.users.example.jp","records":[{"type":"A","value":"203.0.113.42"}]}'

$ dig tkim.users.example.jp A +short    # @-prefix なし、つまり public hierarchy 経由
203.0.113.42

$ dig @8.8.8.8 tkim.users.example.jp A +short
203.0.113.42
```

Google の resolver からも引けるようになりました。レジストラ → `ns1.example.jp` → ConoHa3 VPS 上の PowerDNS という、本物の権威 DNS 階層です。

---

## conoha-cli 側でも 4 件出てきた

検証中に conoha-cli 自体の小さな問題も見つかったので、別途 Issue として登録しました。

| Issue | 内容 |
|-------|------|
| [#193](https://github.com/crowdy/conoha-cli/issues/193) | `network sgr list/show` の `port_range_min/max` が Go ポインタアドレスとして表示される (table 出力のみ。JSON 出力は正常) |
| [#194](https://github.com/crowdy/conoha-cli/issues/194) | `network sg delete <name>` が HTTP 405 を返す。ID のみ受け付け。他のリソースは name でも削除可なので一貫性がない |
| [#195](https://github.com/crowdy/conoha-cli/issues/195) | `app deploy` の **初回** が `app env set` で設定した値を accessory コンテナに反映しない。DB が default password で初期化されてしまい、再 deploy + volume 削除が必要 |
| [#196](https://github.com/crowdy/conoha-cli/issues/196) | `g2d-*` フレーバー (組み込みディスク有り) が `block_device_mapping required` で失敗。`g2l-*` (ボリューム作成型) は同じ引数で通る |

特に #195 は今回の検証作業を一番遅らせたバグでした。最初の `app deploy` の直後に `pdns` が「password 認証失敗」になって、しばらく「自分の `gpgsql-password` 同期ロジックが間違ってるのか？」を疑っていました。実際は CLI 側で env が反映されていなかっただけ。

---

## まとめ

| 項目 | 結果 |
|------|---|
| Phase 1 検証 | サンプル構成 + 検証 1-6 すべて pass |
| Phase 2 検証 | `conoha app deploy` + Let's Encrypt + 実ドメイン NS 委任 + public hierarchy 経由解決まで pass |
| サンプル側で見つけたバグ | 3 件 (`:53` バインド / `POSTGRES_PASSWORD` 同期 / テストの負キャッシュ race) |
| 直したコミット | [0a3382f](https://github.com/crowdy/conoha-cli-app-samples/commit/0a3382f), [dd4c9da](https://github.com/crowdy/conoha-cli-app-samples/commit/dd4c9da), [b8fdb5d](https://github.com/crowdy/conoha-cli-app-samples/commit/b8fdb5d) |
| conoha-cli 側で見つけたバグ | 4 件 ([#193-196](https://github.com/crowdy/conoha-cli/issues/193)) |
| マージされた PR | [crowdy/conoha-cli-app-samples#95](https://github.com/crowdy/conoha-cli-app-samples/pull/95) |

「ローカルで完結しないサンプル」は CI で見つかる前に実機検証フェーズを挟むしかないんですが、その分得られるものは大きいです。今回もサンプル側 3 件 + ツール側 4 件、合計 **7 件のバグが本番投入前に拾えました**。特に「`POSTGRES_PASSWORD` の同期問題」は README に注記してあったとはいえ、99% のユーザーは踏むだろうと思って、`command:` で自動シンクするように構成変更しました。

そしてこの一連の作業 — VPS 作成、SSH 経由の OS セットアップ、`compose` 起動、API 検証、`conoha app deploy`、Let's Encrypt 証明書取得、CRUD テスト、3 つの fix コミット、4 つの upstream issue 起票、PR description 更新、最後にマージ — はすべて Claude Code に丸投げしました。`conoha-cli-skill` を入れておけば「`feat/dns-server-sample` を ConoHa3 で実機検証して」と日本語で頼むだけで、こういう深さまで自走してくれます。

### 参考

- [crowdy/conoha-cli-app-samples - dns-server サンプル](https://github.com/crowdy/conoha-cli-app-samples/tree/main/dns-server)
- [PR #95 — feat(dns-server): personal DNS hosting sample with FastAPI admin API](https://github.com/crowdy/conoha-cli-app-samples/pull/95)
- [PowerDNS Authoritative Server](https://doc.powerdns.com/authoritative/)
- [PowerDNS gpgsql backend schema](https://github.com/PowerDNS/pdns/blob/master/modules/gpgsqlbackend/schema.pgsql.sql)
- [example.jp](https://example.jp/) — 着想元
- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)
