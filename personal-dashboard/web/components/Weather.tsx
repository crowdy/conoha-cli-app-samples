"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SectionEnvelope, Weather as W } from "@/lib/types";

export function Weather() {
  const [env, setEnv] = useState<SectionEnvelope<W | null> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.weather();
        if (!cancelled) setEnv(r);
      } catch {
        // keep previous data
      }
    };
    load();
    const id = window.setInterval(load, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!env || !env.data) {
    return <div className="text-sm text-gray-400 dark:text-gray-500">天気情報読込中…</div>;
  }
  const w = env.data;
  return (
    <div className="text-sm text-gray-700 dark:text-gray-300 flex items-center justify-center gap-2">
      <span>{w.city_label}</span>
      <span>{w.current_temp_c ?? "--"}°</span>
      <span>{w.current_condition}</span>
      <span>→</span>
      <span>{w.forecast_high_c ?? "--"}°/{w.forecast_low_c ?? "--"}°</span>
      <span>{w.forecast_condition}</span>
      {env.last_error ? <span title={env.last_error} className="text-yellow-500">⚠</span> : null}
    </div>
  );
}
