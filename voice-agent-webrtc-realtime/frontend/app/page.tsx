"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { MODE_STYLES } from "@/components/ModeTheme";
import { MODES } from "@/lib/types";

export default function Home() {
  const [origin, setOrigin] = useState("");
  const [qrs, setQrs] = useState<Record<string, string>>({});

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        MODES.map(async (mode) => {
          const url = `${origin}/talk?mode=${mode}`;
          const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
          return [mode, dataUrl] as const;
        }),
      );
      if (!cancelled) setQrs(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [origin]);

  return (
    <main className="min-h-screen bg-neutral-950 p-8 text-white">
      <h1 className="mb-2 text-2xl font-bold">注文受付 AI — デモ</h1>
      <p className="mb-8 text-sm opacity-60">
        スマホで QR を撮って、好きな「通信プロトコル」で注文してみてください。
      </p>
      <div className="grid gap-8 sm:grid-cols-3">
        {MODES.map((mode) => {
          const style = MODE_STYLES[mode];
          return (
            <div
              key={mode}
              className="flex flex-col items-center gap-3 rounded-xl bg-neutral-900 p-6"
            >
              <div className="text-lg font-bold">
                {style.emoji} {style.label}
              </div>
              {qrs[mode] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrs[mode]}
                  alt={`${style.label} の QR コード`}
                  className="rounded bg-white p-2"
                  width={320}
                  height={320}
                />
              ) : (
                <div className="h-[320px] w-[320px] animate-pulse rounded bg-neutral-800" />
              )}
              <a
                href={`/talk?mode=${mode}`}
                className="text-sm underline opacity-70"
              >
                /talk?mode={mode}
              </a>
            </div>
          );
        })}
      </div>
    </main>
  );
}
