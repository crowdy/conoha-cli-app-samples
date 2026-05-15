"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ModeBadge, MODE_STYLES } from "@/components/ModeTheme";
import { PushToTalk } from "@/components/PushToTalk";
import { Transcript } from "@/components/Transcript";
import {
  closeRealtime,
  sendEvent,
  setMicEnabled,
  startRealtime,
  type RealtimeSession,
} from "@/lib/realtime";
import { isMode, type Mode, type TranscriptEntry } from "@/lib/types";

function TalkInner() {
  const params = useSearchParams();
  const rawMode = params.get("mode");
  const mode: Mode = isMode(rawMode) ? rawMode : "callcenter";
  const style = MODE_STYLES[mode];

  const sessionRef = useRef<RealtimeSession | null>(null);
  const [ready, setReady] = useState(false);
  const [talking, setTalking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  // Append assistant transcript deltas, or push a finished user line.
  function handleEvent(event: Record<string, unknown>) {
    const type = event.type as string;

    if (type === "response.audio_transcript.delta") {
      const delta = event.delta as string;
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && !last.done) {
          return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
        }
        return [
          ...prev,
          {
            id: `a-${Date.now()}-${Math.random()}`,
            role: "assistant",
            text: delta,
            done: false,
          },
        ];
      });
    } else if (type === "response.audio_transcript.done") {
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && !last.done) {
          return [...prev.slice(0, -1), { ...last, done: true }];
        }
        return prev;
      });
    } else if (
      type === "conversation.item.input_audio_transcription.completed"
    ) {
      setTranscript((prev) => [
        ...prev,
        {
          id: `u-${Date.now()}-${Math.random()}`,
          role: "user",
          text: event.transcript as string,
          done: true,
        },
      ]);
    }
  }

  // PushToTalk's onPointerDown is the user gesture that lets iOS Safari
  // grant getUserMedia; the WebRTC session is created on first press.
  async function handleStart() {
    setError(null);
    if (!sessionRef.current) {
      try {
        sessionRef.current = await startRealtime(mode, handleEvent);
        setReady(true);
      } catch (err) {
        setError(`接続に失敗しました: ${String(err)}`);
        return;
      }
    }
    setMicEnabled(sessionRef.current, true);
    setTalking(true);
  }

  function handleStop() {
    setTalking(false);
    const session = sessionRef.current;
    if (!session) return;
    setMicEnabled(session, false);
    // Push-to-talk: end the user turn and ask for a response.
    sendEvent(session, { type: "input_audio_buffer.commit" });
    sendEvent(session, { type: "response.create" });
  }

  useEffect(() => {
    return () => {
      if (sessionRef.current) closeRealtime(sessionRef.current);
    };
  }, []);

  return (
    <main
      className={`min-h-screen p-4 flex flex-col gap-4 ${style.page} ${style.font}`}
    >
      <ModeBadge mode={mode} />
      {error && (
        <div className="rounded bg-black/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      <Transcript entries={transcript} />
      <PushToTalk
        style={style}
        ready={ready || sessionRef.current === null}
        talking={talking}
        onStart={handleStart}
        onStop={handleStop}
      />
    </main>
  );
}

export default function TalkPage() {
  return (
    <Suspense fallback={<main className="p-8 text-white">読み込み中…</main>}>
      <TalkInner />
    </Suspense>
  );
}
