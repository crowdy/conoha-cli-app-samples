---
title: conoha-cliでBun + Elysia + SQLiteのWebSocketリアルタイムチャットをConoHa VPSにワンコマンドデプロイ
tags: Bun Elysia websocket SQLite Conoha
author: crowdy
slide: false
---
## はじめに

「Node.js 以外の JavaScript ランタイムを本番で使ってみたい」と思ったことはありませんか？2024年以降、**[Bun](https://bun.sh/)** は一気に注目を集め、起動速度・パッケージインストール速度・標準ライブラリの充実度で Node.js を突き放しつつあります。

そして Bun 上で動くことを前提に設計された Web フレームワークが **[Elysia](https://elysiajs.com/)** です。型安全なルーティング、TypeBoxベースのバリデーション、そして **WebSocket の pub/sub を1級市民として扱う** という特徴を持っています。

この記事では、Bun + Elysia + SQLite（`bun:sqlite`）で作ったリアルタイムチャットアプリを、ConoHa VPS3 上に `conoha app deploy` ワンコマンドでデプロイする方法を紹介します。DBサービスは不要、**コンテナは1つだけ** というミニマル構成です。

デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使います。サーバー作成からアプリ起動まで、手元のターミナルだけで完結します。

---

## 使用するスタック

| コンポーネント | 役割 |
|---|---|
| **Bun** v1 | JavaScriptランタイム（Node.js互換 + 独自API） |
| **Elysia** v1.4 | Bun ネイティブな Web フレームワーク |
| **bun:sqlite** | Bun組み込みの SQLite3 ドライバ（外部依存ゼロ） |
| **@elysiajs/static** | 静的ファイル配信プラグイン |

### アーキテクチャ

```
ブラウザ
  ↓ HTTP + WebSocket
Elysia (:3000)
  ├── GET  /          → 静的HTML（チャットクライアント）
  ├── GET  /api/messages → 過去のメッセージ履歴
  ├── GET  /health    → ヘルスチェック
  └── WS   /ws        → WebSocket（join/message/leave）
         ↓
     bun:sqlite → /data/chat.db (Dockerボリューム)
```

PostgreSQLやRedisのような外部DBは一切不要です。SQLiteファイルをDockerボリュームに永続化するだけで、メッセージ履歴は残り続けます。

---

## conoha-cli とは

[conoha-cli](https://github.com/crowdy/conoha-cli) は、ConoHa VPS3 をターミナルから操作するためのCLIツールです。

### 主な機能

- **サーバー管理**: VPSの作成・削除・一覧表示
- **app deploy**: `compose.yml` があるディレクトリをVPSにデプロイ
- **app logs**: コンテナログのリアルタイム表示
- **app status**: コンテナの稼働状態確認
- **環境変数管理**: `app env set` でセキュアに環境変数を注入

`app deploy` コマンドは内部でDockerとDocker Composeを自動セットアップし、ディレクトリをgit push形式でVPSへ転送してコンテナを起動します。SSHキーさえ設定すれば、コマンド1本でデプロイが完了します。

---

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み（`conoha keypair create` で作成可能）

---

## ファイル構成

```
bun-elysia-chat/
├── src/
│   ├── db.ts         # SQLite（bun:sqlite）
│   ├── ws.ts         # WebSocketハンドラ
│   └── index.ts      # エントリポイント
├── public/
│   └── index.html    # チャットクライアント
├── compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
└── README.md
```

10ファイル、しかもDBサービスが不要なので `compose.yml` も非常にシンプルです。

---

## なぜ Bun + Elysia なのか

### 1. ビルドステップがない

Bunは TypeScript をネイティブに実行できます。`node_modules` も要らない、ビルドツールチェーンも要らない、`bun run src/index.ts` でそのまま動きます。Dockerfile も極めてシンプルになります。

### 2. WebSocket の pub/sub が組み込み

Elysia の WebSocket は、Bun のネイティブ WebSocket API をラップしています。`ws.subscribe(topic)` と `ws.publish(topic, data)` だけでブロードキャストが書けます。Redis も不要です。

```typescript
app.ws("/ws", {
  open(ws) {
    ws.subscribe("chat"); // "chat" トピックを購読
  },
  message(ws, raw) {
    ws.publish("chat", payload); // 購読者全員に配信（自分以外）
  },
});
```

### 3. `bun:sqlite` で SQLite が組み込み

Node.js で SQLite を使う場合は `better-sqlite3` などのネイティブバインディングが必要でしたが、Bun には **最初から** SQLite が組み込まれています。

```typescript
import { Database } from "bun:sqlite";
const db = new Database("/data/chat.db", { create: true });
```

---

## src/db.ts: SQLite でメッセージ保存

```typescript
import { Database } from "bun:sqlite";

export type Message = {
  id: number;
  nickname: string;
  content: string;
  created_at: string;
};

const DB_PATH = process.env.DB_PATH || "/data/chat.db";
const db = new Database(DB_PATH, { create: true });

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

export function saveMessage(nickname: string, content: string): Message {
  const stmt = db.prepare(
    "INSERT INTO messages (nickname, content) VALUES (?, ?) RETURNING *"
  );
  return stmt.get(nickname, content) as Message;
}

export function getMessages(limit = 50): Message[] {
  const stmt = db.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT ?");
  return (stmt.all(limit) as Message[]).reverse();
}
```

`prepared statement` + `RETURNING *` で、INSERT した行をそのまま取り出せます。Bunの SQLite は同期API なので、async/await のオーバーヘッドもありません。

---

## src/ws.ts: WebSocket ハンドラ

Elysia の `ws()` メソッドで WebSocket エンドポイントを定義します。pub/sub トピック "chat" を使ってメッセージをブロードキャストします。

```typescript
import { Elysia } from "elysia";
import { saveMessage } from "./db";

const MAX_NICKNAME_LEN = 32;
const MAX_CONTENT_LEN = 2000;

// WebSocket id → nickname のマップ（プロセス内メモリ）
const nicknames = new Map<string, string>();

function parseFrame(raw: unknown): Record<string, unknown> | null {
  try {
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    }
    if (typeof raw === "object" && raw !== null) {
      return raw as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function sanitizeNickname(value: unknown): string {
  const s = String(value ?? "").trim().slice(0, MAX_NICKNAME_LEN);
  return s || "anonymous";
}

function sanitizeContent(value: unknown): string {
  return String(value ?? "").slice(0, MAX_CONTENT_LEN).trim();
}

export const wsRoutes = new Elysia().ws("/ws", {
  open(ws) {
    ws.subscribe("chat");
  },

  message(ws, raw) {
    const data = parseFrame(raw);
    if (!data || typeof data.type !== "string") return;

    if (data.type === "join") {
      const nickname = sanitizeNickname(data.nickname);
      nicknames.set(ws.id, nickname);
      const payload = JSON.stringify({
        type: "join",
        nickname,
        online: nicknames.size,
      });
      ws.send(payload);         // 自分にも送る
      ws.publish("chat", payload); // 他の購読者に配信
      return;
    }

    if (data.type === "message") {
      const nickname = nicknames.get(ws.id) || "anonymous";
      const content = sanitizeContent(data.content);
      if (!content) return;
      const saved = saveMessage(nickname, content);
      const payload = JSON.stringify({
        type: "message",
        id: saved.id,
        nickname: saved.nickname,
        content: saved.content,
        createdAt: saved.created_at,
      });
      ws.send(payload);
      ws.publish("chat", payload);
    }
  },

  close(ws) {
    const nickname = nicknames.get(ws.id);
    if (!nickname) return;
    nicknames.delete(ws.id);
    ws.publish(
      "chat",
      JSON.stringify({ type: "leave", nickname, online: nicknames.size })
    );
  },
});
```

ポイント:

- **`ws.publish()` は送信元を除外して配信する** ため、自分にも届けたいときは `ws.send()` を併用する
- **`parseFrame()` で不正なJSONをサイレントに無視** するので、悪意あるクライアントや単なる誤送信でハンドラが落ちない
- **nicknameは32文字、contentは2000文字までに制限** して、悪意あるクライアントから巨大なペイロードを投げられても安全
- **`close` で実際にjoin済みだった場合のみleaveを配信** するので、認証前に切断されたクライアントのノイズが入らない

---

## src/index.ts: エントリポイント

```typescript
import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { getMessages } from "./db";
import { wsRoutes } from "./ws";

const app = new Elysia()
  .use(staticPlugin({ prefix: "/public", assets: "public" }))
  .use(wsRoutes)
  .get("/", () => Bun.file("public/index.html"))
  .get("/api/messages", ({ query }) => {
    const limit = Number(query.limit) || 50;
    return getMessages(Math.min(limit, 200));
  })
  .get("/health", () => ({ status: "ok" }))
  .listen(3000);

console.log(`Server running on port ${app.server?.port}`);
```

メソッドチェーンで全エンドポイントを定義しているのが Elysia らしいスタイルです。`Bun.file()` は Bun 組み込みのファイルレスポンスヘルパで、`fs.readFile` せずに効率的にファイルを返せます。

---

## フロントエンド: WebSocket + 自動再接続

`public/index.html` は vanilla JS で書いたシンプルなチャットクライアントです。ポイントだけ抜粋します。

```javascript
let ws;
let myNickname = "";

function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "join", nickname: myNickname }));
  };

  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    // join / leave / message の種別ごとに描画
  };

  ws.onclose = () => {
    statusEl.textContent = "Disconnected. Reconnecting...";
    setTimeout(connect, 2000); // 2秒後に自動再接続
  };
}

async function loadHistory() {
  const res = await fetch("/api/messages?limit=50");
  const msgs = await res.json();
  msgs.forEach(renderMessage);
}
```

接続時に過去50件の履歴を REST で取得し、以降は WebSocket でリアルタイム更新を受け取る、というよくある構成です。`onclose` で2秒後に自動再接続するので、サーバー再起動中でも画面をリロードする必要はありません。

メッセージ表示時は `escapeHtml()` でユーザー入力をエスケープしています。サンプルコードですが、ここを怠るとXSSがそのまま刺さるので、チャットアプリを書くときは必ず入れてください。

---

## compose.yml と Dockerfile

```yaml
services:
  web:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - chat_data:/data
    restart: unless-stopped

volumes:
  chat_data:
```

シンプルすぎて拍子抜けするかもしれません。`db` サービスはありません。`chat_data` ボリュームに SQLite ファイル1個が置かれるだけです。

```dockerfile
FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY . .
RUN mkdir -p /data
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
```

`bun install --production` は `npm install --production` の Bun 版です。Bun は Node.js より **数倍速く** パッケージをインストールするので、ビルド時間が短縮されます。

---

## デプロイ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/bun-elysia-chat
```

### 2. サーバー作成

```bash
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
```

### 3. アプリ初期化

```bash
conoha app init myserver --app-name bun-chat
```

```
Initializing app "bun-chat" on vm-18268c66-ae (133.88.116.147)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
Initialized empty Git repository in /opt/conoha/bun-chat.git/
==> Installing post-receive hook...
==> Done!

App "bun-chat" initialized on vm-18268c66-ae (133.88.116.147).
```

### 4. デプロイ

```bash
conoha app deploy myserver --app-name bun-chat
```

```
Archiving current directory...
Uploading to vm-18268c66-ae (133.88.116.147)...
Building and starting containers...
 Image bun-chat-web Building
#6 [1/6] FROM docker.io/oven/bun:1-alpine
#9 [4/6] RUN bun install --production
#9 0.494 bun install v1.3.11
#9 3.187 Resolved, downloaded and extracted [76]
#9 3.243 + @elysiajs/static@1.4.7
#9 3.243 + elysia@1.4.28
#9 3.243 19 packages installed [2.76s]
#9 DONE 3.4s
 Image bun-chat-web Built
 Volume bun-chat_chat_data Created
 Container bun-chat-web-1 Started
NAME             IMAGE          STATUS                  PORTS
bun-chat-web-1   bun-chat-web   Up Less than a second   0.0.0.0:3000->3000/tcp
Deploy complete.
```

`bun install` がたった **2.76秒** で76個のパッケージを解決・ダウンロード・展開しています。`npm install` とは別次元の速度です。

---

## 動作確認

### ヘルスチェック

```bash
curl http://<サーバーIP>:3000/health
# {"status":"ok"}
```

### メッセージ履歴 API

```bash
curl http://<サーバーIP>:3000/api/messages
# []
```

### WebSocket 接続テスト

Node.js から WebSocket で接続してみます。

```javascript
const ws = new WebSocket("ws://<サーバーIP>:3000/ws");

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "join", nickname: "test-user" }));
  setTimeout(() => {
    ws.send(JSON.stringify({ type: "message", content: "Hello from WS!" }));
  }, 500);
};

ws.onmessage = (e) => console.log("RECV:", e.data);
```

実行結果:

```
RECV: {"type":"join","nickname":"test-user","online":1}
RECV: {"type":"message","id":1,"nickname":"test-user","content":"Hello from WS!","createdAt":"2026-04-09 11:28:57"}
```

SQLite に永続化されているので、`/api/messages` で履歴が取れます。

```bash
curl http://<サーバーIP>:3000/api/messages
```

```json
[
  {
    "id": 1,
    "nickname": "test-user",
    "content": "Hello from WS!",
    "created_at": "2026-04-09 11:28:57"
  }
]
```

### ブラウザでチャット

`http://<サーバーIP>:3000` にアクセスすると、ニックネーム入力画面が表示されます。ニックネームを入れてJoinするとチャットルームに入れます。複数ブラウザタブで開けば、リアルタイム通信が確認できます。

---

## このサンプルの良いところ

### 圧倒的にシンプルな構成

- **1コンテナだけ**: DBサービスを立てる必要がない
- **1ボリュームだけ**: SQLite ファイル1個
- **ビルドステップなし**: TypeScript のまま本番で動く
- **依存パッケージ2個**: `elysia` と `@elysiajs/static` だけ

### Bun の速度を体感できる

`bun install` のインストール速度、起動時間、メモリ使用量、すべてが Node.js + `tsx` より軽量です。特に小規模サービスで「立ち上がりの速さ」が欲しい場合、Bun は大きな武器になります。

### Elysia の WebSocket pub/sub が秀逸

Node.js で同じことをやろうとすると、`socket.io` を入れるか、`ws` パッケージ + 自前でルームを管理するか、Redis pub/sub を導入するかのいずれかになります。Elysia なら `ws.subscribe()` と `ws.publish()` だけで済みます。

---

## 制限事項

### 単一レプリカ前提

この構成は **単一レプリカ前提** です。オンラインユーザー一覧をプロセス内メモリで管理しているため、複数レプリカに水平スケールするとユーザー一覧が整合しません。マルチレプリカでスケールしたい場合は、プレゼンス情報を Redis などの共有ストアに移す必要があります。

### 書き込みスループット

SQLite は単一ファイルへの書き込みがシリアライズされるので、**メッセージ送信レートが秒間数百を超える** ような規模になると頭打ちになります。その場合は PostgreSQL + pub/sub に移行するタイミングです。

とはいえ、個人のDiscord風コミュニティや社内ツールなら、SQLite1個で十分すぎるほどのキャパシティがあります。

---

## まとめ

conoha-cli の `app init` → `app deploy` の2コマンドで、Bun + Elysia + SQLite のリアルタイムチャットアプリを ConoHa VPS3 上に構築できました。

| アクセス先 | URL |
|---|---|
| チャット画面 | `http://<IP>:3000` |
| メッセージ履歴API | `http://<IP>:3000/api/messages` |
| WebSocket | `ws://<IP>:3000/ws` |
| ヘルスチェック | `http://<IP>:3000/health` |

「WebSocket付きの軽量サービスを、最小コンテナ数で、最速で立ち上げたい」というニーズに対して、Bun + Elysia + SQLite はほぼ完璧な答えです。PostgreSQLも Redis もいりません。1GBメモリの ConoHa VPS でも余裕で動きます。

次に WebSocket を使う小さなサービスを作るときは、この構成を試してみてください。Node.js + Express + ws + Redis を使っていた時代と比べて、驚くほど身軽に感じるはずです。

## 参考リンク

- サンプルコード: [crowdy/conoha-cli-app-samples/bun-elysia-chat](https://github.com/crowdy/conoha-cli-app-samples/tree/main/bun-elysia-chat)
- conoha-cli: [crowdy/conoha-cli](https://github.com/crowdy/conoha-cli)
- note.comでのconoha-cli紹介: [ConoHa VPSを便利に扱うCLIを作った話](https://note.com/kim_tonghyun/n/n77b464a61dc0?from=notice)
- [Bun 公式サイト](https://bun.sh/)
- [Elysia 公式ドキュメント](https://elysiajs.com/)
- [Elysia WebSocket ドキュメント](https://elysiajs.com/patterns/websocket.html)

他にもWordPress、Strapi、Supabase、Outline、Quickwit + OpenTelemetryなど30種類以上のサンプルが揃っていますので、ぜひ試してみてください。

