---
title: ConoHa L4 GPU で『電話料金ゼロ』の音声受注エージェントを自己ホストする — voice-agent-conoha-l4 サンプル
tags: Conoha conoha-cli WebRTC vLLM ClaudeCode
author: crowdy
slide: false
---
## はじめに

「電話で注文を受けたい」「現場から無線連絡を録音・テキスト化したい」「コールセンターを 1 人で回したい」——どれも電話番号と SIP トランクとオペレータが必要な世界の話です。月々の固定費だけで数千円〜数万円、回線契約には法人手続き、しかも音声から構造化データへの変換は別途。

このサンプル [`voice-agent-conoha-l4`](https://github.com/crowdy/conoha-cli-app-samples/tree/main/voice-agent-conoha-l4) は、**電話・SIP トランク・コールセンター HW を一切使わず**、QR コードをスキャンしてブラウザのマイクから話しかけるだけで、AI が音声を聞き取り、注文を Google Sheets に書き込み、別ブラウザにリアルタイム配信する、というデモを 1 つの ConoHa L4 GPU VPS で完結させます。

**外部 AI サービス（OpenAI / Anthropic / Google）への通信は一切ありません**。STT・LLM・TTS すべて ConoHa の NVIDIA L4 GPU 上で自己ホストします。社内利用制限で OpenAI を使えない案件、データを社外に出せない案件にも適用できます。

---

## 3 つの「通信プロトコル人格」

同じ「○○食堂の注文受付 AI」を、3 つの通信プロトコル風の人格でスキニングしています。**やっていることは全部同じ（メニューを取って Sheets に書く）**ですが、口調と UI が違うだけで全く別のユースケースに見える、というデモです。

| モード | 人格 | ユースケース例 |
|---|---|---|
| 🚑 emergency | 救急通信センター | 救急隊員が現場から音声で患者情報を入力 |
| 🪖 military | 作戦司令部 | 無線交信風の補給品目報告 |
| ☎️ callcenter | コールセンター | 飲食店の電話注文受付（実用シナリオ） |

ブラウザで `/` を開くと 3 枚の QR コードが並びます。各 QR は `mode=emergency` などのクエリ付きで `/talk` ページに飛び、その人格に応じた system prompt で AI が応答します。

実装上は **system prompt の 1 文字列だけが違う** という、最小コストで最大の見た目変化を生む構成です:

```python
# agent/app/personas.py より抜粋
PERSONAS: dict[str, str] = {
    "emergency": (
        "これは救急通信センターです。要請内容を簡潔に確認します。"
        "聞き取った内容を即座に add_order ツールで登録してください。"
        "口調は冷静で短く、医療従事者の指示に従うトーンを保ってください。"
    ),
    "military": (
        "作戦司令部です。報告を受領します。コールサインを発信してください。"
        "受領した品目は add_order ツールで記録します。"
        "口調は無線連絡風、復唱を含めて簡潔に。"
    ),
    "callcenter": (
        f"{_RESTAURANT}、ご注文承ります。"
        "丁寧で温かい接客口調を保ち、聞き漏らしがないよう数量と品名を確認します。"
        "確認できたら add_order ツールで登録し、最後に close_order で締めます。"
    ),
}
```

ツール（`add_order` / `update_order` / `close_order` / `list_orders`）の中身は 3 モードで完全に共通です。

---

## 使用するスタック

| レイヤー | 技術 | 役割 |
|---|---|---|
| フロント | Next.js 16（App Router, standalone） | QR ランディング + `/talk`（WebRTC クライアント） |
| Voice Agent | Python + aiortc + Silero VAD | WebRTC サーバー、ターンテーキング、会話ループ |
| STT | faster-whisper (medium, ja/en/ko 自動) | 音声→テキスト |
| LLM | vLLM + Qwen2.5-7B-Instruct-AWQ | 対話・関数呼び出し |
| TTS | Style-BERT-VITS2 | テキスト→音声（日本語） |
| バックエンド | FastAPI | 注文 REST + Google Sheets + WebSocket 配信 |
| GPU | NVIDIA L4 24GB (`g2l-t-c4m16g1-l4`) | 推論ハードウェア |
| インフラ | conoha-cli / conoha-proxy / Docker Compose | デプロイと TLS 終端 |

### アーキテクチャ

```
                    ┌────────────────── ConoHa L4 24GB VPS ──────────────────┐
                    │                                                        │
   ┌─────────┐      │  ┌──────────────────┐                                  │
   │ Browser │◄──TLS┤  │ conoha-proxy     │                                  │
   │ /talk   │ HTTPS│  │ (ACME Let's Enc) │                                  │
   └────┬────┘      │  └────────┬─────────┘                                  │
        │ WebRTC    │           │                                            │
        │ (Opus     │           ▼                                            │
        │  双方向)  │  ┌──────────────────┐  ┌──────────────────┐            │
        ├──────────►│  │ frontend         │  │ agent            │            │
        │           │  │ Next.js 16       │  │ Python + aiortc  │            │
        │           │  │ QR / talk UI     │  │ ┌──────────────┐ │            │
        │  DataCh   │  └──────────────────┘  │ │ Silero VAD   │ │            │
        │◄──────────┤                        │ ├──────────────┤ │            │
        │ user_txt  │  ┌──────────────────┐  │ │ faster-whisper│ │  ┌───────┐│
        │ tool_call │  │ backend          │  │ │  (STT 16kHz) │ │  │ Google││
        │ persisted │  │ FastAPI          │◄─┤ ├──────────────┤ ├─►│ Sheets││
        │           │  │ ┌──────────────┐ │  │ │ → vLLM Qwen  │ │  └───────┘│
        │           │  │ │ orders REST  │ │  │ │  2.5-7B-AWQ  │ │            │
        │           │  │ │ Sheets sync  │ │  │ ├──────────────┤ │            │
        │           │  │ │ WS broker    │ │  │ │ Style-BERT-  │ │            │
        │           │  │ └──────────────┘ │  │ │  VITS2 (TTS) │ │            │
        │           │  └──────┬───────────┘  │ └──────────────┘ │            │
        │ WS /events│         │              └──────────────────┘            │
        └──────────►│         │                                              │
                    │  ┌──────▼──────────────────────────────────────────┐   │
                    │  │ vLLM container (Qwen2.5-7B-Instruct-AWQ, 8GB)   │   │
                    │  └────────────────────────────────────────────────-┘   │
                    │                                                        │
                    └────────────────────────────────────────────────────────┘
                              GPU: 13GB / 24GB 使用（同時 5 セッション想定）
```

ポイントは「**ブラウザは agent の WebRTC エンドポイントとしか話さない**」ことです。音声は WebRTC の audio track で双方向に流れ、UI ステートは同じ PeerConnection の DataChannel で同期します。

### 会話ループの核心

agent の会話ループは依存注入のテスト可能な構造になっています:

```python
# agent/app/loop.py より抜粋
class ConversationLoop:
    async def turn(self, pcm16: bytes, emit) -> bytes:
        text, lang = await self._stt.transcribe(pcm16)  # 音声 → テキスト
        emit({"type": "user_transcript", "text": text, "language": lang})

        # 1 回目の LLM 呼び出し: ツール呼び出しを判定
        assistant_msg = await self._llm.chat(
            messages=self._build_messages() + [{"role": "user", "content": text}],
            tools=OPENAI_TOOLS,
            tool_choice="auto",
        )

        # ツール実行 → backend HTTP → Sheets
        if assistant_msg.get("tool_calls"):
            for call in assistant_msg["tool_calls"]:
                result = await self._exec.dispatch(call["function"]["name"], ...)
                emit({"type": "order_persisted", "order_id": result["order_id"]})

            # 2 回目の LLM: ツール結果を踏まえた最終応答（テキスト確定）
            final = await self._llm.chat(messages=..., tools=..., tool_choice="none")

        return await self._tts.synthesize(final["content"], language=lang)
```

`stt` / `llm` / `tts` を Protocol 注入にすることで GPU なしでもテスト可能になっています。

---

## デプロイ手順

```bash
# 1. L4 GPU 付き VPS を作成
conoha server create --no-input --yes --wait \
  --name voice-agent-l4 \
  --flavor g2l-t-c4m16g1-l4 \
  --image vmi-docker-29.2-ubuntu-24.04-amd64 \
  --key-name <keyname> \
  --security-group default --security-group IPv4v6-SSH \
  --security-group IPv4v6-Web --security-group IPv4v6-ICMP

# 2. NVIDIA ドライバ + git-lfs インストール（要 reboot）
IP=$(conoha server show voice-agent-l4 --format json | jq -r ...)
ssh root@$IP 'apt install -y nvidia-driver-595-server-open \
  nvidia-container-toolkit nvidia-utils-595-server git-lfs && reboot'

# 3. conoha-proxy 起動（ACME 自動取得）
conoha proxy boot --acme-email you@example.com voice-agent-l4

# 4. .env 作成（PUBLIC_BASE_URL, SHEET_ID, SA JSON 等）
# 5. init → SBV2 weight 配置 → deploy
cd voice-agent-conoha-l4
conoha app init voice-agent-l4
ssh root@$IP bash < scripts/fetch-sbv2-weights.sh
conoha app deploy voice-agent-l4
```

初回 deploy は CUDA イメージ pull + モデル DL で 10〜20 分、ウォームアップ 90〜120 秒後に `/healthz` が 200 になります。

---

## 静的レビューでは見えなかった 12 のバグ

PR を切る前に **5 段階のコードレビュー**（フェーズ別 × 4 + 最終クロスカット × 1）を回しましたが、それでも実 VPS スモークで **12 個の追加バグ**が出ました。要約だけ:

| カテゴリ | 例 | 検出に必要だったもの |
|---|---|---|
| パッケージピン誤り | `style-bert-vits2==2.6.1` が PyPI 未登録（max は 2.5.0）／ `nvidia/cuda:12.4.1-runtime-ubuntu24.04` Docker tag 不在 | 実 `pip install` / `docker pull` |
| 未宣言の transitive dep | `faster-whisper 1.0.3` が `requests` を import するのに依存宣言なし | コンテナ lifespan 実行 |
| デッドコード dep の解決衝突 | `pipecat-ai==0.0.50` を使ってもいないのに pin → `pydantic~=2.8.2` で衝突 | pip 解決 |
| compose `environment: - KEY` の罠 | shorthand は親シェルの env しか pass-through しない。`.env` の値はコンテナに入らない | 別 user で deploy（自分のシェルに変数がない状況） |
| 権限 / prefetch 漏れ | `USER ubuntu` で root 所有 volume に書けない／pyopenjtalk が初回 dict DL を read-only path に試みる／BERT 2GB を Dockerfile prefetch 漏れ | 非 root user で実行 |
| ライブラリ間 dtype 非互換 | `torch 2.12.0` + `style-bert-vits2 2.5.0` で TTS が `Half vs Float` で死ぬ | 実 GPU 推論 |

修正の一例（`compose.yml`）:

```yaml
# Before
services:
  agent:
    environment:
      - LLM_MODEL
      - GOOGLE_APPLICATION_CREDENTIALS_JSON

# After（実 deploy 経由で値が入る）
services:
  agent:
    env_file:
      - .env
```

これら 12 個は共通して **「静的解析 + ユニットテスト + コードレビュー」では検出できず、必ず「実 GPU VPS にデプロイして lifespan を完走させる」段階で初めて落ちる**性質のものです。

CI でテスト走らせていても見えません（GPU テストは GPU host 上でないと回らない）。**スモークテストは省略可能ではない**、というのが今回最大の教訓でした。

詳しいリストとパッチは PR [#106](https://github.com/crowdy/conoha-cli-app-samples/pull/106) のコメントとリポジトリの `docs/superpowers/specs/`, `docs/superpowers/plans/` に残しています。これは [Claude Code](https://www.anthropic.com/claude-code) の `superpowers` plugin の `brainstorming → writing-plans → subagent-driven-development → requesting-code-review` ワークフローで構築したため、各ステップの審議過程が文書化されています。

---

## まとめ

- **電話・SIP トランク・コールセンター HW なし** で、QR + ブラウザマイクから音声で注文を受け取り Google Sheets に永続化するデモが、ConoHa L4 GPU 1 枚で動きます。
- 外部 AI への通信ゼロ。STT / LLM / TTS すべて自己ホストです。OpenAI 利用制限のある社内環境やデータ持ち出し制限案件にも適用可能です。
- 3 つの「通信プロトコル人格」は、同じ食堂注文 AI のスキニング違いです。**system prompt の文字列を変えるだけで全く別の業務シミュレーターに見える**、という UI 設計上の発見も得られました。
- 静的レビューでは見えないバグは、必ず「実 VPS にデプロイ」段階で見つかります。**スモークテストを省略しない**、これだけは習慣化する価値があります。

サンプルは [`crowdy/conoha-cli-app-samples/voice-agent-conoha-l4`](https://github.com/crowdy/conoha-cli-app-samples/tree/main/voice-agent-conoha-l4) にあります。

---

### 参考

- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)
- [voice-agent-conoha-l4 サンプル](https://github.com/crowdy/conoha-cli-app-samples/tree/main/voice-agent-conoha-l4)
- [vLLM](https://github.com/vllm-project/vllm) — OpenAI 互換 LLM サーバー
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) — CTranslate2 で高速化された Whisper
- [Style-BERT-VITS2](https://github.com/litagin02/Style-Bert-VITS2) — 日本語コミュニティ製の TTS
- [aiortc](https://github.com/aiortc/aiortc) — Python 製の WebRTC スタック
