"use client";

import type { TranscriptEntry } from "@/lib/types";

export function Transcript({ entries }: { entries: TranscriptEntry[] }) {
  return (
    <section className="rounded-lg bg-black/20 p-4">
      <h2 className="mb-2 text-sm font-bold opacity-70">💬 会話</h2>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={entry.role === "user" ? "text-right" : "text-left"}
          >
            <span
              className={`inline-block rounded-lg px-3 py-1 text-sm ${
                entry.role === "user"
                  ? "bg-white/15"
                  : "bg-white/5 border border-white/10"
              }`}
            >
              <strong className="opacity-60">
                {entry.role === "user" ? "あなた" : "AI"}:{" "}
              </strong>
              {entry.text}
            </span>
          </li>
        ))}
        {entries.length === 0 && (
          <li className="text-sm opacity-40">ボタンを押して話しかけてください</li>
        )}
      </ul>
    </section>
  );
}
