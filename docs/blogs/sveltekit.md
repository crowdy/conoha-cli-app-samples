---
title: conoha-cliでSvelteKitアプリをConoHa VPSにワンコマンドデプロイ
tags: SvelteKit Svelte TypeScript Docker Conoha
author: crowdy
slide: false
---
## はじめに

React、Vue、Angularに次ぐフロントエンドフレームワークとして着実にシェアを伸ばしている **SvelteKit**。2024年のSvelte 5リリースで導入されたRunes（`$state`、`$props`）により、リアクティビティの記述が大きく進化しました。

この記事では、SvelteKit アプリを ConoHa VPS3 上に `conoha app deploy` ワンコマンドでデプロイする方法を紹介します。**ローカルに Node.js や SvelteKit をインストールする必要はありません。** Dockerマルチステージビルドにより、ビルドはすべてサーバー上のコンテナ内で完結します。

デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使います。サーバー作成からアプリ起動まで、手元のターミナルだけで完結します。

## SvelteKitとは

SvelteKit は [Svelte](https://svelte.dev/) のフルスタックフレームワークです。Next.js が React に対して担う役割を、SvelteKit が Svelte に対して担っています。

| 特徴 | 説明 |
|------|------|
| **コンパイラベース** | 仮想DOMを使わず、コンパイル時に最適なJavaScriptを生成 |
| **Svelte 5 Runes** | `$state`、`$derived`、`$effect` によるシンプルなリアクティビティ |
| **SSR / SSG / SPA** | adapter を切り替えるだけでデプロイ先を変更可能 |
| **ファイルベースルーティング** | `src/routes/` のディレクトリ構造がそのままURLになる |
| **バンドルサイズ** | 仮想DOMランタイムが不要なため、極めて軽量 |

Svelte 5 の Runes は、従来の `let count = 0` だけでリアクティブだった暗黙的な仕組みから、`let count = $state(0)` と明示的に宣言する方式に変わりました。コードの意図が明確になり、大規模プロジェクトでの保守性が向上しています。

## ポイント: ローカル環境にNode.jsは不要

conoha-cli のデプロイフローでは **ローカルでのビルドは一切不要** です。

```
[ローカルPC] -- tar+SSH --> [ConoHa VPS]
  ソースコードのみ            Docker内でnpm install → vite build → 起動
```

仕組みはシンプルです:

1. `conoha app deploy` がカレントディレクトリをtar.gzに固めてサーバーへ転送
2. サーバー上で `docker compose up --build` が実行される
3. Dockerfileのマルチステージビルド内で `npm install` と `vite build` が走る
4. 本番用の軽量コンテナが起動する

つまり、ローカルには `node` コマンドすら入っていなくても、ソースコードさえあればデプロイできます。

## ファイル構成

```
sveltekit/
├── src/
│   ├── routes/
│   │   ├── +layout.svelte    # レイアウト（Svelte 5 Runes）
│   │   └── +page.svelte      # トップページ（カウンター）
│   ├── app.css                # グローバルCSS
│   └── app.html               # HTMLテンプレート
├── compose.yml
├── Dockerfile
├── package.json
├── svelte.config.js
├── tsconfig.json
└── vite.config.ts
```

SvelteKit のプロジェクトに `Dockerfile` と `compose.yml` を追加しただけのシンプルな構成です。

## Svelte 5 Runes を使ったページコンポーネント

`src/routes/+page.svelte` にカウンターコンポーネントを実装しています。

```svelte
<script lang="ts">
  let count = $state(0);
</script>

<svelte:head>
  <title>SvelteKit on ConoHa</title>
</svelte:head>

<div class="container">
  <h1>SvelteKit on ConoHa</h1>
  <p>Deployed with <code>conoha app deploy</code></p>
  <div class="card">
    <button onclick={() => count++}>
      Count: {count}
    </button>
  </div>
</div>
```

注目すべきは `let count = $state(0)` の1行です。Svelte 5 では `$state` ルーンで状態を宣言し、`onclick` にはReactと同じ構文でイベントハンドラを書けます。`on:click` ディレクティブは不要になりました。

レイアウトコンポーネント（`+layout.svelte`）も Svelte 5 の Runes を使っています。

```svelte
<script>
  import "../app.css";
  let { children } = $props();
</script>

{@render children()}
```

`$props()` でプロパティを受け取り、`{@render children()}` でスロットの代わりにchildren を描画します。Svelte 4 の `<slot />` から、より明示的な記法に変わりました。

## Dockerfile

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production runner
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./
RUN npm install --omit=dev
EXPOSE 3000
ENV PORT=3000
CMD ["node", "build"]
```

2段階のマルチステージビルドです。SvelteKit の `adapter-node` は `npm run build` で `build/` ディレクトリに自己完結型の Node.js サーバーを生成します。`node build` だけで起動できるため、最終イメージには `build/` と `package.json` のみをコピーしています。

### svelte.config.js

```javascript
import adapter from "@sveltejs/adapter-node";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
  },
};

export default config;
```

`adapter-node` がポイントです。SvelteKit はデフォルトで `adapter-auto` を使いますが、VPS上で Node.js サーバーとして動かすには `adapter-node` に変更します。これにより `npm run build` が自己完結型のサーバーを生成します。

### compose.yml

```yaml
services:
  web:
    build: .
    ports:
      - "3000:3000"
```

これだけです。データベースも外部サービスも不要なので、compose.ymlは最小限です。

## 使用パッケージ（2026年4月時点の最新版）

| パッケージ | バージョン | 役割 |
|---|---|---|
| `svelte` | 5.55.3 | UIフレームワーク |
| `@sveltejs/kit` | 2.57.1 | フルスタックフレームワーク |
| `@sveltejs/adapter-node` | 5.5.4 | Node.jsサーバー出力 |
| `@sveltejs/vite-plugin-svelte` | 7.0.0 | ViteプラグインでSvelteをビルド |
| `vite` | 8.0.8 | ビルドツール |
| `typescript` | 6.0.2 | 型チェック |

Vite 8、TypeScript 6 といった2026年最新のツールチェインで動作確認済みです。

## デプロイ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/sveltekit
```

### 2. サーバー作成（既存サーバーがあればスキップ）

```bash
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey --wait
```

### 3. アプリ初期化

```bash
conoha app init myserver --app-name sveltekit
```

```
Initializing app "sveltekit" on vm-18268c66-ae (133.88.116.147)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
==> Installing post-receive hook...
==> Done!
```

### 4. デプロイ

```bash
conoha app deploy myserver --app-name sveltekit
```

```
Archiving current directory...
Uploading to vm-18268c66-ae (133.88.116.147)...
Building and starting containers...
 Image sveltekit-web Building
#9 [builder 4/6] RUN npm install
#9 59.43 added 69 packages, and audited 70 packages in 58s
#11 [builder 6/6] RUN npm run build
#11 2.602 vite v8.0.8 building ssr environment for production...
#11 4.870 ✓ built in 2.27s
#11 4.884 > Using @sveltejs/adapter-node
#11 6.082   ✔ done
 Container sveltekit-web-1 Started
Deploy complete.
```

**ローカルでは `npm install` も `npm run build` も実行していません。** すべてサーバー上のDockerビルド内で完結しています。

## 動作確認

ブラウザで `http://<サーバーIP>:3000` にアクセスすると、SvelteKit のカウンターアプリが表示されます。

```bash
conoha app status myserver --app-name sveltekit
```

```
NAME              IMAGE           STATUS        PORTS
sveltekit-web-1   sveltekit-web   Up 1 second   0.0.0.0:3000->3000/tcp
```

ボタンをクリックするとカウンターが増加します。SSRで初期HTMLがレンダリングされ、ハイドレーション後はクライアントサイドでリアクティブに動作します。

## ハマりポイント: なし

SvelteKit + adapter-node の組み合わせは非常に安定しています。`adapter-node` が生成する `build/` ディレクトリには必要なファイルがすべて含まれており、`node build` で即座に起動できます。Dockerfileも直感的で、特殊な設定は一切不要でした。

## SvelteKit vs Next.js: adapter の設計思想

SvelteKit の特徴的な設計として、**adapter** の仕組みがあります。

| Adapter | 出力先 | 用途 |
|---|---|---|
| `adapter-node` | Node.jsサーバー | VPS、Docker |
| `adapter-static` | 静的HTML | GitHub Pages、S3 |
| `adapter-vercel` | Vercel Functions | Vercel |
| `adapter-cloudflare` | Workers | Cloudflare |

同じソースコードを adapter の変更だけで異なるプラットフォームにデプロイできます。今回は `adapter-node` を使いましたが、将来的に Cloudflare Workers に移行したい場合は `adapter-cloudflare` に変えるだけです。これは Next.js の `output: "standalone"` とは異なるアプローチで、デプロイ先の切り替えがよりクリーンです。

## まとめ

`conoha app init` → `conoha app deploy` の2コマンドで、SvelteKit アプリを ConoHa VPS3 上にデプロイできました。

| 特徴 | 詳細 |
|------|------|
| **ローカルビルド不要** | Node.jsもSvelteKitもローカルにインストール不要 |
| **Svelte 5 Runes** | `$state`、`$props` による明示的なリアクティビティ |
| **adapter-node** | `node build` で起動する自己完結型サーバー |
| **最新ツールチェイン** | Vite 8 + TypeScript 6 で動作確認済み |
| **デプロイ時間** | 初回約1分30秒（ビルド含む） |

| アクセス先 | URL |
|---|---|
| SvelteKit アプリ | `http://<IP>:3000` |

サンプル: https://github.com/crowdy/conoha-cli-app-samples/tree/main/sveltekit

### 参考

- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)
- [SvelteKit 公式ドキュメント](https://svelte.dev/docs/kit)
- [Svelte 5 Runes](https://svelte.dev/docs/svelte/what-are-runes)
