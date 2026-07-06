"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ScheduleItem, SectionEnvelope } from "@/lib/types";
import { TimeBadge } from "./TimeBadge";

interface Props {
  day: "today" | "tomorrow";
  title: string;
}

function fmtRange(start: string, end: string, allDay: boolean) {
  if (allDay) return "終日";
  const s = new Date(start);
  const e = new Date(end);
  const f = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${f(s)}-${f(e)}`;
}

function classify(item: ScheduleItem, now: number) {
  if (item.all_day) return { kind: "all-day" as const };
  const start = new Date(item.start_at).getTime();
  const end = new Date(item.end_at).getTime();
  if (now >= end) return { kind: "past" as const };
  if (now >= start) return { kind: "in-progress" as const, target: item.end_at };
  return { kind: "future" as const, target: item.start_at };
}

export function ScheduleSection({ day, title }: Props) {
  const [env, setEnv] = useState<SectionEnvelope<ScheduleItem[]> | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const r = await api.schedule(day);
      setEnv(r);
    } catch { /* keep previous */ }
  }, [day]);

  useEffect(() => {
    load();
    const poll = window.setInterval(load, 5 * 60 * 1000);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [load]);

  const items = env?.data ?? [];
  const past = items.filter((i) => classify(i, now).kind === "past");
  const visible = items.filter((i) => classify(i, now).kind !== "past");

  const refresh = () => api.refreshSchedule().then(() => setTimeout(load, 500));

  return (
    <section className="space-y-1">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-800 dark:text-gray-200">
          {title}
          {env?.last_error ? <span title={env.last_error} className="ml-1 text-yellow-500">⚠</span> : null}
        </h2>
        <button onClick={refresh} className="text-xs text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400">🔄 更新</button>
      </div>
      {past.length > 0 && (
        <button
          className="text-xs text-gray-500 hover:underline dark:text-gray-400"
          onClick={() => setShowPast((s) => !s)}
        >
          ▼ {showPast ? "折りたたみ" : `折りたたみ済み (${past.length}件)`}
        </button>
      )}
      <ul className="text-sm space-y-0.5">
        {showPast && past.map((it) => <Row key={it.id} item={it} now={now} />)}
        {visible.map((it) => <Row key={it.id} item={it} now={now} />)}
        {items.length === 0 && (
          <li className="text-xs text-gray-400 dark:text-gray-500">予定はありません</li>
        )}
      </ul>
    </section>
  );
}

function Row({ item, now }: { item: ScheduleItem; now: number }) {
  const c = classify(item, now);
  return (
    <li className="flex items-start gap-3">
      <span className="font-mono text-gray-600 dark:text-gray-400 w-28 shrink-0">
        {fmtRange(item.start_at, item.end_at, item.all_day)}
      </span>
      <span className="w-32 shrink-0">
        {c.kind === "all-day" || c.kind === "past" ? null : (
          <TimeBadge
            targetISO={c.target}
            mode={c.kind === "in-progress" ? "until-end" : "until-start"}
          />
        )}
      </span>
      <span className="text-gray-800 dark:text-gray-200 whitespace-pre-line">{item.title}</span>
    </li>
  );
}
