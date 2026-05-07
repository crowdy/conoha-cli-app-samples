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
conoha app logs dns-server pdns-init
# 出力に "ADMIN_TOKEN=..." の行が含まれる (初回のみ)
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
- **`audit_log` の肥大化**: `app.audit_log` は API 操作のたびに append されるが、自動削除されない。長期運用時は定期的に `TRUNCATE app.audit_log` するか、`created_at` を基準とした期間 DELETE をスケジュールすること

## 参考

- [PowerDNS Authoritative Server](https://doc.powerdns.com/authoritative/)
- [PowerDNS gpgsql backend schema](https://github.com/PowerDNS/pdns/blob/master/modules/gpgsqlbackend/schema.pgsql.sql)
- [ndnd.jp](https://ndnd.jp/) — 着想元
