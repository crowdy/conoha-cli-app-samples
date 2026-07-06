"use client";
import { useEffect, useState } from "react";
import { formatRemaining, timeColorState } from "@/lib/timeColor";

type Mode = "until-target" | "until-start" | "until-end";

interface Props {
  targetISO: string;
  mode: Mode;
  prefix?: string;
}

function useTick(intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
}

export function TimeBadge({ targetISO, mode, prefix }: Props) {
  useTick();
  const remaining = new Date(targetISO).getTime() - Date.now();
  const state = timeColorState(remaining);
  const text = formatRemaining(remaining);
  const display =
    mode === "until-end" && state !== "red"
      ? `${prefix ?? "進行中"}(残${text})`
      : remaining > 0
        ? `あと${text}`
        : mode === "until-target"
          ? "終了"
          : "経過";
  const cls =
    state === "blink"
      ? "blink-warn font-medium"
      : state === "yellow"
        ? "color-yellow font-medium"
        : state === "red"
          ? "color-red font-medium"
          : "color-normal font-medium";
  return <span className={cls}>{display}</span>;
}
