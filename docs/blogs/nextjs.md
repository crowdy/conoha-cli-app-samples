---
title: conoha-cliでNext.jsアプリをConoHa VPSにワンコマンドデプロイ
tags: Next.js Docker Conoha conoha-cli React
author: crowdy
slide: false
---
### はじめに

Next.js アプリを自前のVPSにデプロイしたいけど、Vercelのような簡単さは諦めるしかない——そう思っていませんか？

この記事では、Next.js アプリを ConoHa VPS3 上に `conoha app deploy` ワンコマンドでデプロイする方法を紹介します。**ローカルに Node.js や Next.js をインストールする必要はありません。** Dockerマルチステージビルドにより、ビルドはすべてサーバー上のコンテナ内で完結します。

デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使います。サーバー作成からアプリ起動まで、手元のターミナルだけで完結します。

### ポイント: ローカル環境にNode.jsは不要

通常、Next.jsの開発では `npm install` → `npm run build` をローカルで実行しますが、conoha-cli のデプロイフローでは **ローカルでのビルドは一切不要** です。

```
[ローカルPC] -- tar+SSH --> [ConoHa VPS]
  ソースコードのみ            Docker内でnpm ci → next build → 起動
```

仕組みはシンプルです:

1. `conoha app deploy` がカレントディレクトリをtar.gzに固めてサーバーへ転送
2. サーバー上で `docker compose up --build` が実行される
3. Dockerfileのマルチステージビルド内で `npm ci` と `next build` が走る
4. 本番用の軽量コンテナが起動する

つまり、ローカルには `node` コマンドすら入っていなくても、ソースコードさえあればデプロイできます。

### ファイル構成

```
nextjs/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── public/
├── compose.yml
├── Dockerfile
├── next.config.ts
├── package.json
├── package-lock.json
└── tsconfig.json
```

Next.jsのプロジェクトに `Dockerfile` と `compose.yml` を追加しただけのシンプルな構成です。

### Dockerfile

```dockerfile
# Stage 1: Install dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build the application
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: Production runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
```

3段階のマルチステージビルドで、最終イメージには本番実行に必要なファイルだけが含まれます。Next.jsの `output: "standalone"` オプションにより、`node_modules` をコピーする必要がなく、軽量なイメージになります。

### next.config.ts

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

`output: "standalone"` がポイントです。これにより `next build` が `.next/standalone` ディレクトリに自己完結型のサーバーを生成し、`node server.js` だけで起動できるようになります。

### compose.yml

```yaml
services:
  web:
    build: .
    ports:
      - "3000:3000"
```

これだけです。データベースも外部サービスも不要なので、compose.ymlは最小限です。

### デプロイ手順

#### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/nextjs
```

#### 2. サーバー作成（既存サーバーがあればスキップ）

```bash
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey --wait
```

#### 3. アプリ初期化

```bash
conoha app init myserver --app-name nextjs
```

```
Initializing app "nextjs" on vm-18268c66-ae (133.88.116.147)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
==> Installing post-receive hook...
==> Done!
```

#### 4. デプロイ

```bash
conoha app deploy myserver --app-name nextjs
```

```
Archiving current directory...
Uploading to vm-18268c66-ae (133.88.116.147)...
Building and starting containers...
 Image nextjs-web Building
 ...
#9 [deps 4/4] RUN npm ci
#9 14.04 added 30 packages, and audited 31 packages in 13s
 ...
#12 [builder 5/5] RUN npm run build
#12 3.815    ▲ Next.js 15.5.14
#12 3.946    Creating an optimized production build ...
#12 16.99  ✓ Compiled successfully in 9.2s
 ...
 Container nextjs-web-1 Started
Deploy complete.
```

**ローカルでは `npm install` も `npm run build` も実行していません。** すべてサーバー上のDockerビルド内で完結しています。

### 動作確認

ブラウザで `http://<サーバーIP>:3000` にアクセスすると、Next.jsアプリが表示されます。

```bash
conoha app status myserver --app-name nextjs
```

```
NAME           IMAGE        STATUS                  PORTS
nextjs-web-1   nextjs-web   Up Less than a second   0.0.0.0:3000->3000/tcp
```

### 今回のサンプル: GitHub Releasesダウンロード数ダッシュボード

サンプルとして、[crowdy/conoha-cli](https://github.com/crowdy/conoha-cli) のGitHub Releasesダウンロード数を表示するダッシュボードをデプロイしました。

Next.jsのServer Componentsで GitHub API からリリース情報を取得し、ISR（Incremental Static Regeneration）で5分間キャッシュしています。

```typescript
async function getReleases(): Promise<Release[]> {
  const res = await fetch(
    "https://api.github.com/repos/crowdy/conoha-cli/releases",
    { next: { revalidate: 300 } }
  );
  if (!res.ok) return [];
  return res.json();
}
```

認証なしのGitHub APIはレート制限が60回/時なので、ISRによるキャッシュは必須です。

### ハマりポイント: なし

Next.jsは `output: "standalone"` の公式サポートが充実しており、Dockerfileもほぼ公式ドキュメントのままで動きます。WordPressの記事で「ハマりポイント: なし」と書きましたが、Next.jsも同様に、標準的な構成ならスムーズにデプロイできました。

### まとめ

`conoha app init` → `conoha app deploy` の2コマンドで、Next.jsアプリをConoHa VPS3上にデプロイできました。

| 特徴 | 詳細 |
|------|------|
| **ローカルビルド不要** | Node.jsもNext.jsもローカルにインストール不要 |
| **マルチステージビルド** | 本番イメージは軽量な `node:22-alpine` ベース |
| **ISR対応** | `output: "standalone"` でISRも正常動作 |
| **デプロイ時間** | 初回約1分（ビルド含む）、2回目以降はキャッシュで高速化 |

| アクセス先 | URL |
|---|---|
| Next.js アプリ | `http://<IP>:3000` |

サンプル: https://github.com/crowdy/conoha-cli-app-samples/tree/main/nextjs


### 参考

- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)

