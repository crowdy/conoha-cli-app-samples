# dns-server — 個人向け DNS ホスティングサンプル

[ndnd.jp](https://ndnd.jp/) のようにサブドメインを払い出せる権威 DNS サーバーを ConoHa VPS3 上にセルフホストするサンプル。`PowerDNS Authoritative` + `PostgreSQL gpgsql` バックエンド + `FastAPI` 製の管理 API という構成で、`curl` から `tkim.users.example.com` のようなサブドメインを CRUD できる。

## 構成

```
                                        Internet
                                            │
                  ┌─────────────────────────┼─────────────────────────┐
                  │ :53/udp,tcp             │ :443                    │
                  ▼                         ▼                         │
     ┌─────────────────────┐    ┌──────────────────────┐              │
     │ PowerDNS (host net) │    │ conoha-proxy (HTTPS) │              │
     └────────────┬─────────┘    └──────────┬───────────┘              │
                  │                          ▼                          │
                  │              ┌──────────────────────┐               │
                  │              │ FastAPI (:8080)      │               │
                  │              │ Bearer token auth    │               │
                  │              └──────────┬───────────┘               │
                  ▼                         ▼                           │
              ┌────────────────────────────────────┐                    │
              │ PostgreSQL 17 (gpgsql + app schema)│                    │
              └────────────────────────────────────┘                    │
                                  └─────────────────────────────────────┘
```

| サービス | 役割 |
|---------|-----|
| `pdns` | PowerDNS Authoritative 4.9。`network_mode: host` で `:53/udp,tcp` を直接占有。 |
| `app` | FastAPI 管理 API。conoha-proxy 経由で HTTPS 公開。 |
| `db` | PostgreSQL 17。PowerDNS gpgsql スキーマ + 我々の `app` スキーマを保持。 |
| `pdns-init` | 起動時 1 回実行: スキーマ適用 + 親 zone (SOA/NS) 種付け + admin token 生成。 |

## 前提

- `conoha-cli >= 0.3.0`
- 自前ドメイン (例 `example.com`) を保有
- VPS の `:53/udp`, `:53/tcp`, `:443` が開放可能

## デプロイ

### 1. レジストラで NS 委任

レジストラのコントロールパネルで、自分が管理したい親ゾーン (例 `users.example.com`) の NS レコードを VPS の IP に向ける:

```
users.example.com.    NS    ns1.example.com.
ns1.example.com.      A     <VPS IP>
```

`ns1.example.com` の glue を提供できないレジストラの場合は、A レコードと NS の親ドメインで対応する手順を README で各自確認。

### 2. systemd-resolved の `:53` を解放 (Ubuntu 24.04)

```bash
sudo sed -i 's/^#DNSStubListener=yes/DNSStubListener=no/' /etc/systemd/resolved.conf
sudo sed -i 's/^DNSStubListener=yes/DNSStubListener=no/' /etc/systemd/resolved.conf
sudo systemctl restart systemd-resolved
sudo ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf
```

### 3. ファイアウォール

```bash
sudo ufw allow 53/udp
sudo ufw allow 53/tcp
```

### 4. ConoHa VPS 起動 + デプロイ

```bash
# サーバー作成
conoha server create --name dns-server --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# proxy 起動 (1 度のみ)
conoha proxy boot --acme-email you@example.com dns-server

# conoha.yml の hosts: と各環境変数を編集してから:
conoha app init dns-server
conoha app deploy dns-server
```

### 5. 環境変数

`compose.yml` の各 `${VAR:-default}` は以下で上書き可能。本番では最低限 `PARENT_ZONE`, `PRIMARY_NS`, `SOA_EMAIL`, `POSTGRES_PASSWORD` を上書きする:

| 変数 | 既定 | 用途 |
|------|------|------|
| `PARENT_ZONE` | `users.example.com` | 管理する親ゾーン |
| `PRIMARY_NS` | `ns1.example.com.` | SOA / NS の primary nameserver。trailing dot 必須 |
| `SOA_EMAIL` | `admin.example.com.` | SOA RNAME (`@` を `.` に置換した DNS 形式) |
| `POSTGRES_PASSWORD` | `pdns` | DB パスワード |
| `ADMIN_TOKEN` | (空) | 空ならコンテナログに 1 度だけ生成・出力 |
| `ENV` | `prod` | `dev` で `/docs` 露出 |

> **注意**: `POSTGRES_PASSWORD` を既定 (`pdns`) 以外に変更した場合、`pdns/pdns.conf` の `gpgsql-password=` 行も同じ値に書き換える必要がある。PowerDNS は Docker Compose の環境変数を補間しないため、この同期は手動で行う必要がある。

### 6. 初回起動時のトークン取得

```bash
conoha app logs <server-name> --app-name dns-server --service pdns-init
# 出力に "ADMIN_TOKEN=..." の行が含まれる (初回のみ)
```

### 7. トークン回転

`pdns-init` は `app.api_tokens` が空の場合のみトークンを生成する。回転するには既存トークンを削除してから `pdns-init` を再実行:

```bash
# DB に直接接続してトークンレコードを削除
conoha app exec <server-name> --app-name dns-server --service db -- \
  psql -U pdns -d pdns -c "DELETE FROM app.api_tokens"

# pdns-init を再実行 (新しいトークンがログに出力される)
conoha app exec <server-name> --app-name dns-server --service pdns-init -- /entrypoint.sh

# あるいは ADMIN_TOKEN 環境変数を明示指定して再デプロイ
ADMIN_TOKEN=<new-token> conoha app deploy <server-name>
```

## API 早見表

| Method | Path | 認証 | 用途 |
|--------|------|-----|-----|
| `GET` | `/health` | 不要 | DB 疎通確認 |
| `GET` | `/v1/zone` | 不要 | 親 zone のメタ |
| `GET` | `/v1/subdomains` | 必要 | 一覧 |
| `POST` | `/v1/subdomains` | 必要 | 新規作成 (重複は 409) |
| `GET` | `/v1/subdomains/{name}` | 必要 | 単件 + 子孫情報 |
| `PUT` | `/v1/subdomains/{name}` | 必要 | records 全置換 (idempotent) |
| `DELETE` | `/v1/subdomains/{name}` | 必要 | 削除。子孫がいれば応答に告知 |

エンドツーエンド例は [`examples/curl.sh`](examples/curl.sh) 参照。

### サポートするレコードタイプ

`A`, `AAAA`, `CNAME`, `TXT`。MX/SRV/NS は v1 範囲外。CNAME は同一名の他レコードと共存不可 (RFC 1034)。

### バリデーション

- 名前は親ゾーンで終わる (例: `*.users.example.com`)
- 各ラベルは RFC 1035 (1-63 文字、`[a-z0-9-]`、ハイフン先頭/末尾不可)
- 先頭ラベルが予約語 (`www`, `api`, `admin`, `mail`, `ns`, `ns1`, `ns2`, `mx`, `localhost`, `root`) の場合は拒否
- 1 サブドメインあたりレコード数 ≤ 20
- TTL は 60 ≤ ttl ≤ 86400

## 動作確認

```bash
# 親ゾーンの SOA
dig @<VPS-IP> users.example.com SOA +short

# 作成後の名前解決 (PowerDNS gpgsql キャッシュ満了まで最大 ~10s)
dig @<VPS-IP> tkim.users.example.com A +short
dig @<VPS-IP> blog.tkim.users.example.com CNAME +short

# 削除後
dig @<VPS-IP> tkim.users.example.com A    # → SERVFAIL/NXDOMAIN
```

## テスト

```bash
docker compose -f compose.yml -f compose.test.yml up -d --build
pip install -r requirements.txt
pytest tests/ -v
docker compose -f compose.yml -f compose.test.yml down -v
```

## 既知の制限

- **冗長化**: v1 は単一 VPS、secondary なし。本番は最低 2 台必要
- **DNSSEC**: 未対応。`pdnsutil secure-zone <zone>` を `pdns` コンテナで実行すれば後付け可能
- **abuse 対策**: 認証トークンのみ。レート制限・CAPTCHA は未実装
- **`network_mode: host`**: pdns コンテナは Docker bridge の名前解決ができないため、`db` を `127.0.0.1:5432` に bind-publish して `pdns.conf` から `gpgsql-host=127.0.0.1` で参照している
- **`audit_log` の肥大化と機密性**: `app.audit_log` は API 操作のたびに append されるが、自動削除されない。長期運用時は定期的に `TRUNCATE app.audit_log` するか、`created_at` を基準とした期間 DELETE をスケジュールすること。**注意**: `payload` カラムには TXT レコードを含むユーザー送信値が平文で残る — DB バックアップや GRANT は機密扱いで管理すること

## 未実装・今後の課題

このサンプルは v1 として「最小の動く DNS ホスティング」を提供する。本番運用に近づけるには以下の実装が追加で必要 — それぞれ独立に着手可能なため、必要なものから取り込めばよい。

### セキュリティ / ハードニング

- **Per-tenant トークンモデル**: 現状は single admin token のみ。`app.api_tokens` テーブルはマルチテナント拡張を阻害しない形で設計済み (`label` 列、`audit_log.token_id` FK)。ルーター側に「トークンが所有するネームスペース範囲」の検証を入れ、自助登録 / トークン発行フロー API を追加すれば本格的な ndnd.jp 相当になる
- **レート制限**: 認証トークンを得た攻撃者が大量サブドメインを生やす abuse は未防止。IP / トークンベースの rate limit middleware (例: `slowapi`) を `app` に組み込む
- **DB レベルの一意制約**: 現在 POST/PUT race は `pg_advisory_xact_lock` で防御しているが、`records (domain_id, name) WHERE type NOT IN ('SOA','NS')` への部分一意インデックスを `app` schema に追加すれば二重防御になる
- **DNSSEC**: `pdnsutil secure-zone <zone>` で後付け可能と記載しているが、本リポジトリではこのコンテナ構成での end-to-end 検証 (鍵生成、`DNSKEY`/`DS` 公開、レジストラへの DS 登録手順) は未実施。動作確認手順を README に追記すべき
- **TLS/HTTPS DNS (DoT/DoH/DNSCrypt)**: 平文 UDP/TCP 53 のみサポート。`:443` (DoH) や `:853` (DoT) は未対応 — 別 sidecar (`dnsdist` 等) で前段配置するパターンを文書化する余地あり
- **予約語ブラックリスト拡充**: 現状 `{www, api, admin, mail, ns, ns1, ns2, mx, localhost, root}`。`cdn`, `ftp`, `webmail`, `cpanel`, `smtp`, `imap`, `pop`, `pop3`, `webdisk`, `autoconfig`, `autodiscover` など c-Panel/Plesk 系の典型ターゲットを追加検討
- **`POSTGRES_PASSWORD` 既定値の強制変更**: `entrypoint.sh` 起動時に既定値 `pdns` を検出したら警告 (or 拒否) する仕組み

### 運用 / 自動化

- **`audit_log` 自動退避ジョブ**: 4 つ目の accessory として `pg_cron` ベースの `DELETE FROM app.audit_log WHERE created_at < now() - interval '90 days'` を定期実行するコンテナを追加。ジョブ間隔と保存期間は環境変数で外出し
- **冗長化 / Secondary NS**: 本サンプルは単一 VPS。レジストラ要件 (最低 2 つの NS) を満たすには別 VPS で `pdns` を `slave` として起動し、`AXFR`/`NOTIFY` で同期する構成が必要。`compose.yml` の secondary プロファイル化、または姉妹サンプル `dns-server-secondary/` への分離が候補
- **Backup / restore**: `db_data` ボリュームの dump/restore 手順、特に `app.api_tokens` を含むバックアップの暗号化要件
- **PowerDNS アップグレード**: 4.9 → 4.10 等のメジャー上げ手順。gpgsql スキーマは LTS 間で安定とされるが、本リポジトリでは未検証
- **Troubleshooting セクション**: `pdns` が起動しない / `db` が unhealthy / `/health` が 503 — 各失敗モードの代表的原因と切り分けコマンドを README に追加

### コード / テスト品質

- **`test_models.py`**: 設計仕様 (`docs/superpowers/specs/2026-05-07-dns-server-sample-design.md`) には記載があるが本 PR では作成せず。Pydantic v2 のシリアライズ往復と `Field` 制約境界 (`ttl=59`, `ttl=86401`, `records` 数 0 / 21 等) を pinning するテストを追加
- **DNS 解決テストのタイミング**: `tests/integration/test_dns.py` は `PROPAGATE = 12s` 固定。低速 VPS や CI で flaky の可能性 — `dig` ポーリングループ化 (最大 30s, 0.5s 間隔) で安定化
- **同時実行テスト**: 同一 name への並列 POST が advisory lock 経由で正しく 1 件のみ作成され、もう一方が 409 を受けるテストを追加
- **`bump_soa` のロギング**: 現状 SOA RDATA パース失敗時は silent。`logger.warning("could not parse SOA serial: %s", ...)` を入れて運用時にデバッグしやすく
- **`conftest.py` teardown**: `clean_records` は each test の事前削除のみ。最後のテスト後にも DB が残るため、test session 終了時の cleanup fixture を追加

## 参考

- [PowerDNS Authoritative Server](https://doc.powerdns.com/authoritative/)
- [PowerDNS gpgsql backend schema](https://github.com/PowerDNS/pdns/blob/master/modules/gpgsqlbackend/schema.pgsql.sql)
- [ndnd.jp](https://ndnd.jp/) — 着想元
