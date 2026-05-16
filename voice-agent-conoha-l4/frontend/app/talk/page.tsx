// voice-agent-conoha-l4/frontend/app/talk/page.tsx
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OrderReceipt } from "@/components/OrderReceipt";
import { OrderTicker } from "@/components/OrderTicker";
import { startVoice, closeVoice, type AgentEvent, type VoiceSession } from "@/lib/voice";
import type { Mode, OrderItem } from "@/lib/types";

const MODE_LABEL: Record<Mode, string> = {
  emergency: "🚑 救急センター",
  military:  "🪖 作戦司令部",
  callcenter:"☎️ コールセンター",
};

function TalkContent() {
  const params = useSearchParams();
  const mode = (params.get("mode") ?? "callcenter") as Mode;

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const sessionRef = useRef<VoiceSession | null>(null);
  const [status, setStatus] = useState<"idle"|"connecting"|"listening"|"speaking"|"error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [items, setItems] = useState<OrderItem[]>([]);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");

  function handleEvent(e: AgentEvent) {
    switch (e.type) {
      case "user_transcript":
        setTranscript(e.text);
        setStatus("speaking");
        break;
      case "tool_call":
        if (e.name === "add_order") setItems((e.args.items as OrderItem[]) ?? []);
        break;
      case "order_persisted":
        setOrderId(e.order_id);
        setStatus("listening");
        break;
      case "assistant_text":
        // optional subtitle UI
        break;
      case "empty_transcript":
        setStatus("listening");
        break;
      case "error":
        setStatus("error");
        break;
    }
  }

  async function connect() {
    if (!mountedRef.current) return;
    setStatus("connecting");
    try {
      const s = await startVoice(mode, handleEvent);
      if (!mountedRef.current) {
        closeVoice(s);
        return;
      }
      sessionRef.current = s;
      setStatus("listening");
    } catch (err) {
      if (mountedRef.current) {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    }
  }

  useEffect(() => () => {
    if (sessionRef.current) closeVoice(sessionRef.current);
  }, []);

  return (
    <main className="min-h-screen p-6 flex flex-col gap-4 max-w-2xl mx-auto">
      <header className="flex justify-between items-center">
        <h1 className="text-2xl">{MODE_LABEL[mode]}</h1>
        <span className="text-xs px-2 py-1 bg-zinc-800 rounded">{status}</span>
      </header>

      {status === "error" && errorMsg && (
        <p className="text-red-400 text-sm">{errorMsg}</p>
      )}

      {status === "idle" && (
        <button onClick={connect} className="bg-emerald-600 rounded-xl py-3">
          通話を開始
        </button>
      )}

      {status !== "idle" && (
        <div className="bg-zinc-900 rounded-xl p-4 min-h-[3rem]">
          <p className="text-sm opacity-70">あなたの発話</p>
          <p className="text-lg">{transcript || "..."}</p>
        </div>
      )}

      <OrderReceipt items={items} status={status === "speaking" ? "pending" : "persisted"} orderId={orderId} />
      <OrderTicker />
    </main>
  );
}

export default function TalkPage() {
  return (
    <Suspense>
      <TalkContent />
    </Suspense>
  );
}
