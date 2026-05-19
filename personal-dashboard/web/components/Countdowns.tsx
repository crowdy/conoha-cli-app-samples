"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Countdown } from "@/lib/types";
import { TimeBadge } from "./TimeBadge";
import { AddCountdownModal } from "./AddCountdownModal";

function fmt(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

export function Countdowns() {
  const [items, setItems] = useState<Countdown[]>([]);
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    try {
      const xs = await api.countdowns();
      setItems(xs);
    } catch { /* keep previous */ }
  };

  useEffect(() => {
    reload();
    const id = window.setInterval(reload, 60_000); // 1 min: catches new past targets dropping off
    return () => window.clearInterval(id);
  }, []);

  const del = async (id: number) => {
    await api.deleteCountdown(id);
    reload();
  };

  return (
    <section className="space-y-1">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-800 dark:text-gray-200">カウントダウン</h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >+ 追加</button>
        )}
      </div>
      {adding && (
        <AddCountdownModal
          onCancel={() => setAdding(false)}
          onCreated={() => { setAdding(false); reload(); }}
        />
      )}
      <ul className="text-sm">
        {items.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-0.5">
            <span className="font-mono text-gray-700 dark:text-gray-300">{fmt(new Date(c.target_at))}</span>
            <span className="inline-block min-w-[80px]">
              <TimeBadge targetISO={c.target_at} mode="until-target" />
            </span>
            <span className="flex-1 text-gray-800 dark:text-gray-200">{c.label}</span>
            <button
              onClick={() => del(c.id)}
              className="text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 text-xs"
              aria-label="delete"
            >×</button>
          </li>
        ))}
        {items.length === 0 && !adding && (
          <li className="text-xs text-gray-400 dark:text-gray-500">登録されたカウントダウンはありません</li>
        )}
      </ul>
    </section>
  );
}
