"use client";

import type { ModeStyle } from "@/components/ModeTheme";

interface PushToTalkProps {
  style: ModeStyle;
  /** true once the WebRTC session is connected. */
  ready: boolean;
  talking: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function PushToTalk({
  style,
  ready,
  talking,
  onStart,
  onStop,
}: PushToTalkProps) {
  return (
    <button
      type="button"
      disabled={!ready}
      onPointerDown={onStart}
      onPointerUp={onStop}
      onPointerLeave={() => talking && onStop()}
      className={`w-full rounded-xl py-6 text-xl font-bold select-none transition disabled:opacity-40 ${style.button} ${
        talking ? "scale-95 ring-4 ring-white/40" : ""
      }`}
    >
      {ready ? (talking ? "🎤 録音中…" : "🎤 PRESS TO TALK") : "接続中…"}
    </button>
  );
}
