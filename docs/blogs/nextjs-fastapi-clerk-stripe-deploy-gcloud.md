---
title: Clerk + Stripe SaaSデモをGoogle Cloud（Cloud Run + Cloud SQL + LB）にデプロイした話
tags: GoogleCloud CloudRun CloudSQL LoadBalancer Clerk Stripe Next.js FastAPI Claude
author: crowdy
slide: false
---
## はじめに

[前回の記事](./nextjs-fastapi-clerk-stripe.md)で、Clerk認証 + Stripeサブスクリプション決済のSaaSデモアプリをConoHa VPSにデプロイしました。今回はそれを **Google Cloud** に移行します。

構成は **Cloud Run**（frontend / backend）+ **Cloud SQL**（PostgreSQL）+ **External Application Load Balancer** の正攻法パターン。gcloudコマンドのパラメータは覚える必要がないくらい複雑ですが、**Claude Code** に任せたらほぼ全自動でした。

ただし、組織ポリシーの制限で `allUsers` が使えないという壁にぶつかり、**`--no-invoker-iam-check`** という回避策を見つけるまでにいくつかハマりポイントがありました。同じ構成を試す方の参考になれば。

## アーキテクチャ

### ConoHa VPS（移行前）

```
ブラウザ → :80 → [frontend (Next.js 16)]
                      │
                      │ rewrites /api/* → backend:8000
                      ▼
                  [backend (FastAPI)] ← :8000 ← Webhook
                      │
                      ▼
                  [db (PostgreSQL 17)]
```

単一VM上のDocker Compose。シンプルだが、スケーラビリティは限定的。

### Google Cloud（移行後）

```
ブラウザ → [External Application LB]
                │
                ├─ /*        → [Cloud Run: frontend]
                │
                ├─ /api/*    → [Cloud Run: backend]
                │                    │
                │                    │ Cloud SQL Proxy (Unix socket)
                │                    ▼
                │               [Cloud SQL: PostgreSQL 17]
                │
Stripe/Clerk Webhook ─┘
```

| コンポーネント | GCPサービス | 備考 |
|---------------|------------|------|
| frontend | Cloud Run | Next.js 16、ポート3000 |
| backend | Cloud Run | FastAPI、ポート8000 |
| DB | Cloud SQL (PostgreSQL 17) | db-f1-micro、asia-northeast1 |
| LB | External Application LB | Serverless NEG経由でCloud Runにルーティング |
| 静的IP | Global External IP | LBのフロントエンド |

## 事前準備

### gcloud CLI インストール

```bash
curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz
tar -xf google-cloud-cli-linux-x86_64.tar.gz
./google-cloud-sdk/install.sh
source ~/.bashrc
gcloud init
```

### プロジェクト設定

```bash
# 請求アカウントのリンク（必須）
gcloud billing projects link <PROJECT_ID> --billing-account=<BILLING_ACCOUNT_ID>

# リージョン設定
gcloud config set compute/region asia-northeast1
```

## デプロイ手順

### 1. API有効化

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  compute.googleapis.com \
  sql-component.googleapis.com
```

> **ハマりポイント①**: `sql-component.googleapis.com` を忘れると、Cloud Runデプロイ時に `--add-cloudsql-instances` がエラーになる。Cloud SQL Admin API（`sqladmin.googleapis.com`）とは別のAPIなので注意。

### 2. Artifact Registry（Dockerイメージ置き場）

```bash
gcloud artifacts repositories create saas-demo \
  --repository-format=docker \
  --location=asia-northeast1
```

### 3. Cloud SQL インスタンス作成

```bash
gcloud sql instances create saas-demo-db \
  --database-version=POSTGRES_17 \
  --tier=db-f1-micro \
  --region=asia-northeast1 \
  --edition=enterprise

gcloud sql databases create appdb --instance=saas-demo-db
gcloud sql users set-password postgres --instance=saas-demo-db --password=<PASSWORD>
```

> **ハマりポイント②**: `--edition=enterprise` を省略すると `ENTERPRISE_PLUS` がデフォルトになり、`db-f1-micro` が使えない（`Invalid Tier for ENTERPRISE_PLUS Edition`）。最小構成で試すなら明示的に `--edition=enterprise` を指定する。

### 4. Dockerイメージ Build & Push

```bash
REPO=asia-northeast1-docker.pkg.dev/<PROJECT_ID>/saas-demo

# 認証設定
gcloud auth configure-docker asia-northeast1-docker.pkg.dev

# backend
docker build -t $REPO/backend ./backend
docker push $REPO/backend

# frontend（ビルド時にClerk公開キーが必要）
docker build -t $REPO/frontend \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx \
  ./frontend
docker push $REPO/frontend
```

### 5. Cloud Run デプロイ — backend

```bash
gcloud run deploy backend \
  --image=$REPO/backend \
  --region=asia-northeast1 \
  --port=8000 \
  --add-cloudsql-instances=<PROJECT_ID>:asia-northeast1:saas-demo-db \
  --set-env-vars="DATABASE_URL=postgresql+asyncpg://postgres:<PW>@/appdb?host=/cloudsql/<PROJECT_ID>:asia-northeast1:saas-demo-db" \
  --set-env-vars="STRIPE_SECRET_KEY=sk_test_xxxxx" \
  --set-env-vars="CLERK_JWKS_URL=https://xxx.clerk.accounts.dev/.well-known/jwks.json" \
  --set-env-vars="STRIPE_PRO_PRICE_ID=price_xxxxx" \
  --set-env-vars="STRIPE_ENTERPRISE_PRICE_ID=price_xxxxx"
```

> **ハマりポイント③**: Cloud Runのデフォルトポートは **8080**。FastAPIは8000でリッスンしているので、`--port=8000` を忘れると `The user-provided container failed to start and listen on the port` で起動に失敗する。

> **ハマりポイント④**: Cloud SQL接続に `asyncpg` を使う場合、DATABASE_URLのホスト部分は `?host=/cloudsql/<INSTANCE_CONNECTION_NAME>` というクエリパラメータ形式。さらに Cloud Run のサービスアカウントに **`roles/cloudsql.client`** が必要。

```bash
# Cloud SQL接続権限の付与
PROJECT_NUM=$(gcloud projects describe <PROJECT_ID> --format="value(projectNumber)")
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:${PROJECT_NUM}-compute@developer.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

### 6. Cloud Run デプロイ — frontend

```bash
gcloud run deploy frontend \
  --image=$REPO/frontend \
  --region=asia-northeast1 \
  --port=3000 \
  --set-env-vars="NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx" \
  --set-env-vars="CLERK_SECRET_KEY=sk_test_xxxxx" \
  --set-env-vars="NEXT_PUBLIC_API_URL=https://backend-xxxxx.run.app/api" \
  --set-env-vars="NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in" \
  --set-env-vars="NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up"
```

## Load Balancer 構築

Cloud Runは組織ポリシーで `allUsers` への公開が制限される場合がある。その場合、Load Balancerを経由して公開する。

### 構成要素

```
[静的IP] → [Forwarding Rule] → [HTTP Proxy] → [URL Map] → [Backend Service] → [Serverless NEG] → [Cloud Run]
```

### 7. Serverless NEG 作成

```bash
# frontend用
gcloud compute network-endpoint-groups create frontend-neg \
  --region=asia-northeast1 \
  --network-endpoint-type=serverless \
  --cloud-run-service=frontend

# backend用
gcloud compute network-endpoint-groups create backend-neg \
  --region=asia-northeast1 \
  --network-endpoint-type=serverless \
  --cloud-run-service=backend
```

### 8. Backend Service 作成 & NEG紐付け

```bash
# frontend
gcloud compute backend-services create frontend-backend \
  --load-balancing-scheme=EXTERNAL_MANAGED --global
gcloud compute backend-services add-backend frontend-backend \
  --global \
  --network-endpoint-group=frontend-neg \
  --network-endpoint-group-region=asia-northeast1

# backend
gcloud compute backend-services create backend-backend \
  --load-balancing-scheme=EXTERNAL_MANAGED --global
gcloud compute backend-services add-backend backend-backend \
  --global \
  --network-endpoint-group=backend-neg \
  --network-endpoint-group-region=asia-northeast1
```

### 9. URL Map（パスベースルーティング）

```bash
# デフォルトはfrontend、/api/*はbackendにルーティング
gcloud compute url-maps create saas-demo-lb \
  --default-service=frontend-backend --global

gcloud compute url-maps add-path-matcher saas-demo-lb \
  --path-matcher-name=api-matcher \
  --default-service=frontend-backend \
  --path-rules="/api/*=backend-backend" \
  --global
```

### 10. 静的IP + HTTP Proxy + Forwarding Rule

```bash
# 静的IP予約
gcloud compute addresses create saas-demo-ip --ip-version=IPV4 --global
gcloud compute addresses describe saas-demo-ip --global --format="value(address)"
# → 例: 34.120.106.199

# HTTP Proxy
gcloud compute target-http-proxies create saas-demo-http-proxy \
  --url-map=saas-demo-lb --global

# Forwarding Rule
gcloud compute forwarding-rules create saas-demo-http-rule \
  --load-balancing-scheme=EXTERNAL_MANAGED \
  --target-http-proxy=saas-demo-http-proxy \
  --ports=80 \
  --address=saas-demo-ip \
  --global
```

## ハマりポイント⑤: 組織ポリシーで403

LBを構築しても **403 Forbidden** が返ってくる場合がある。

### 原因

組織ポリシー `iam.allowedPolicyMemberDomains` により、Cloud Runサービスに `allUsers` や `allAuthenticatedUsers` の `run.invoker` ロールを付与できない。LBからCloud Runへのトラフィックは認証なしで届くため、IAMチェックで拒否される。

```bash
# これが失敗する
gcloud run services add-iam-policy-binding backend \
  --member=allUsers --role=roles/run.invoker
# → FAILED_PRECONDITION: One or more users named in the policy
#   do not belong to a permitted customer
```

### 解決策: `--no-invoker-iam-check`

Cloud Runには **IAM Invokerチェックを無効化**するオプションがある。代わりに **ingress制御** でLBからのトラフィックのみ許可する。

```bash
# backend
gcloud run services update backend \
  --region=asia-northeast1 \
  --ingress=internal-and-cloud-load-balancing \
  --no-invoker-iam-check

# frontend
gcloud run services update frontend \
  --region=asia-northeast1 \
  --ingress=internal-and-cloud-load-balancing \
  --no-invoker-iam-check
```

これにより:
- **IAMチェック**: 無効（誰でもリクエスト可能）
- **ネットワーク制限**: LBまたは内部トラフィックのみ許可
- **直接アクセス**: Cloud RunのURLに直接アクセスしても拒否される

セキュリティ的にも、IAMの代わりにネットワークレベルでアクセス制御するため実用上問題ない。

### 動作確認

```bash
curl http://34.120.106.199/api/health
# → {"status":"ok"}
```

## Webhook URL 更新

LBのIPに変わったので、Stripe / Clerkのwebhook URLを更新する。

### Stripe

```bash
curl -X POST "https://api.stripe.com/v1/webhook_endpoints/<WEBHOOK_ENDPOINT_ID>" \
  -u "$STRIPE_SECRET_KEY:" \
  -d "url=http://<LB_IP>/api/webhooks/stripe"
```

### Clerk（Svix API経由）

Clerkのwebhookは内部的にSvixで管理されているため、Svix APIで更新する。

```bash
# 1. Svixのワンタイムトークンを取得
curl -X POST "https://api.clerk.com/v1/webhooks/svix_url" \
  -H "Authorization: Bearer $CLERK_SECRET_KEY"
# → svix_url のkeyパラメータをbase64デコードしてoneTimeTokenを取得

# 2. Svix APIトークンに交換
curl -X POST "https://api.eu.svix.com/api/v1/auth/one-time-token" \
  -H "Content-Type: application/json" \
  -d '{"oneTimeToken":"<TOKEN>"}'

# 3. エンドポイントURL更新
curl -X PUT "https://api.eu.svix.com/api/v1/app/<APP_ID>/endpoint/<ENDPOINT_ID>" \
  -H "Authorization: Bearer <SVIX_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"url":"http://<LB_IP>/api/webhooks/clerk","version":1,"filterTypes":["user.created"]}'
```

## ログ確認とデプロイ後のトラブルシューティング

デプロイが成功しても安心してはいけない。ログを確認して初めて本当に動いているかがわかる。

### Cloud Run ログの見方

```bash
# 直近のログを確認
gcloud run services logs read backend --region=asia-northeast1 --limit=20
gcloud run services logs read frontend --region=asia-northeast1 --limit=20

# リアルタイムでストリーミング（tail -f 相当）
gcloud run services logs tail backend --region=asia-northeast1

# 重大度でフィルタ（ERRORのみ）
gcloud logging read 'resource.type="cloud_run_revision"
  AND resource.labels.service_name="frontend"
  AND severity>=ERROR' --limit=10
```

### ハマりポイント⑥: Stripe Webhook 署名検証エラー（400）

backendのログを確認すると、Stripe webhookが **400 Bad Request** を返していた。

```
POST 400 http://34.120.106.199/api/webhooks/stripe
POST 400 http://34.120.106.199/api/webhooks/stripe
```

**原因**: `STRIPE_WEBHOOK_SECRET` 環境変数が空のままデプロイされていた。Stripeのwebhook signing secretは、エンドポイント作成時にしか取得できない。URLを変更しただけでは古いsecretが無効になる場合がある。

**対処**: webhookエンドポイントを削除→再作成してsecretを取得し、Cloud Runに設定。

```bash
# 既存エンドポイントの削除
curl -X DELETE "https://api.stripe.com/v1/webhook_endpoints/<ENDPOINT_ID>" \
  -u "$STRIPE_SECRET_KEY:"

# 新規作成（secretが返ってくる）
curl -X POST "https://api.stripe.com/v1/webhook_endpoints" \
  -u "$STRIPE_SECRET_KEY:" \
  -d "url=http://<LB_IP>/api/webhooks/stripe" \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=customer.subscription.updated" \
  -d "enabled_events[]=customer.subscription.deleted"
# → レスポンスの "secret" フィールドを控える

# Cloud Runの環境変数を更新（再デプロイ不要、リビジョンは新規作成される）
gcloud run services update backend \
  --region=asia-northeast1 \
  --update-env-vars="STRIPE_WEBHOOK_SECRET=whsec_xxxxx"
```

### ハマりポイント⑦: Clerk `auth()` が clerkMiddleware を検知できない

frontendのログを確認すると、Clerkの認証エラーが大量に出ていた。

```
⨯ Error: Clerk: auth() was called but Clerk can't detect usage of clerkMiddleware().
  Please ensure the following:
  - clerkMiddleware() is used in your Next.js middleware or proxy file.
  - Your middleware or proxy file exists at ./middleware.(ts|js) or proxy.(ts|js)
```

**原因**: `next.config.ts` の `rewrites` 設定が Docker Compose 用のホスト名 `http://backend:8000` を参照していた。Cloud Run では各サービスが独立しているため、このホスト名は解決できない。rewritesの失敗がミドルウェア処理全体に影響し、Clerkのproxy.tsが正常に動作しなくなっていた。

**対処**: rewritesの宛先を環境変数で切り替えるように変更。Cloud Runでは **LBがパスベースルーティングを行う** ため、rewritesは不要。

```typescript
// next.config.ts — 修正後
import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_INTERNAL_URL;

const nextConfig: NextConfig = {
  output: "standalone",
  ...(backendUrl
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${backendUrl}/api/:path*`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
```

```yaml
# compose.yml — Docker Compose環境ではBACKEND_INTERNAL_URLを設定
services:
  frontend:
    environment:
      - BACKEND_INTERNAL_URL=http://backend:8000
      # ... 他の環境変数
```

Cloud Runデプロイ時は `BACKEND_INTERNAL_URL` を設定しない → rewrites無効 → LBのURL Mapがルーティングを担当。

> **教訓**: Docker Compose前提のネットワーク設定（サービス名での名前解決）は、マネージドサービスに移行すると動かなくなる。環境変数で切り替え可能にしておくと、同じコードベースで両方の環境に対応できる。

## 費用感

| リソース | 月額（概算） |
|----------|------------|
| Cloud Run (frontend + backend) | 無料枠内（低トラフィック時） |
| Cloud SQL (db-f1-micro) | ~$7-10 |
| Load Balancer (forwarding rule) | ~$18 (時間課金: ~$0.025/h) |
| Load Balancer (データ処理) | ~$0.008-0.012/GB |
| 静的IP | $0（使用中は無料） |
| **合計** | **~$25-30/月** |

デモ用途なら、使わないときにCloud SQLを停止すればさらに節約可能。

## Claude Codeの活用

今回のデプロイでは **Claude Code** をフル活用しました。

正直に言うと、gcloudのコマンドは覚えるのが大変です。`--load-balancing-scheme=EXTERNAL_MANAGED` とか `--network-endpoint-type=serverless` とか、毎回ドキュメントを引くのは現実的ではありません。

Claude Codeに「Cloud Run + Cloud SQL + LBでデプロイして」と伝えるだけで:

- **API有効化**からArtifact Registry作成、Cloud SQLインスタンス作成まで一気通貫
- **エラーが出たら即座に原因を診断**（ポート番号の不一致、IAM権限不足、組織ポリシー制限など）
- **LBの6段構成**（NEG → Backend Service → URL Map → HTTP Proxy → Forwarding Rule → 静的IP）も正しい順序で構築
- **組織ポリシーの壁**にぶつかっても `--no-invoker-iam-check` という回避策を自力で発見
- **Webhook URL更新**もStripe API / Svix APIを使って自動実行

- **デプロイ後のログ確認**で問題を発見し、原因特定から修正・再デプロイまで自動実行

人間がやったのは「billing accountのIDを教える」「パスワードを指定する」「LB方式で進めると判断する」「ログを確認して」と依頼するくらいで、gcloudコマンドは一つも手で打っていません。

## まとめ

| 項目 | 内容 |
|------|------|
| 移行元 | ConoHa VPS（Docker Compose） |
| 移行先 | Google Cloud（Cloud Run + Cloud SQL + LB） |
| 所要時間 | 約30分（Claude Codeによる自動構築） |
| ハマりポイント | 7つ（API有効化漏れ、edition指定、ポート番号、DB接続権限、組織ポリシー、Webhook署名、Clerk middleware） |
| 解決の鍵 | `--no-invoker-iam-check` + `--ingress=internal-and-cloud-load-balancing` |

ConoHa VPSのDocker Compose構成から、Google Cloudのマネージドサービス構成への移行は、アプリのコード変更なしで実現できました。Dockerfileをそのまま使い、環境変数の調整だけで済むのがCloud Runの強みです。

gcloudコマンドの複雑さはClaude Codeが吸収してくれるので、「何をしたいか」だけ伝えれば実現できる時代になったと実感します。

## 次回やりたいこと

今回はデプロイまでを扱ったが、本番運用を見据えるとまだやることがある。

### CI/CD
- **GitHub Actions → Cloud Run 自動再デプロイ** — mainブランチへのpushで自動ビルド・デプロイ
- **DB マイグレーション自動化** — GitHub ActionsでAlembicマイグレーションを実行

### 監視・アラート
- **エラー発生時のSlack通知** — Cloud Monitoring + Alert Policy
- **アップタイムチェック** — `/api/health` を定期監視、ダウン時に即通知
- **Cloud Monitoring ダッシュボード** — レイテンシ、エラー率、インスタンス数の可視化
- **ログベースメトリクス** — Stripe webhook失敗率などの異常検知

### インフラ
- **HTTPS化** — カスタムドメイン + Google Managed SSL証明書
- **Cloud Armor** — LBにWAF適用（DDoS防御、レートリミット）
- **Secret Manager** — 環境変数の直接設定からSecret Managerへの移行

### コスト最適化
- **Cloud Run 最小インスタンス設定** — コールドスタート防止（`--min-instances=1`）
- **Cloud SQL の自動起動/停止** — Cloud Schedulerで業務時間帯のみ稼働
- **Budget Alert** — 月額予算超過時のアラート設定
