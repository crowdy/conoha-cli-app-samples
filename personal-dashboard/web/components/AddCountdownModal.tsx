"use client";
import { useState } from "react";
import { api } from "@/lib/api";

interface Props {
  onCancel: () => void;
  onCreated: () => void;
}

export function AddCountdownModal({ onCancel, onCreated }: Props) {
  const [datetime, setDatetime] = useState(""); // local "YYYY-MM-DDTHH:mm"
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setErr(null);
    if (!datetime) { setErr("日付を入力してください"); return; }
    if (!label.trim()) { setErr("ラベルを入力してください"); return; }
    setBusy(true);
    try {
      const iso = new Date(datetime).toISOString();
      await api.createCountdown(iso, label.trim());
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border rounded px-2 py-1 bg-white dark:bg-zinc-800 dark:border-zinc-600">
      <input
        type="datetime-local"
        className="border rounded px-1 py-0.5 text-sm dark:bg-zinc-700 dark:border-zinc-600 dark:text-gray-100"
        value={datetime}
        onChange={(e) => setDatetime(e.target.value)}
      />
      <input
        type="text"
        placeholder="ラベル (例: 旅行出発)"
        className="border rounded px-1 py-0.5 text-sm flex-1 min-w-[160px] dark:bg-zinc-700 dark:border-zinc-600 dark:text-gray-100 dark:placeholder-gray-400"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button
        onClick={save}
        disabled={busy}
        className="bg-blue-500 text-white text-sm px-3 py-0.5 rounded disabled:opacity-50"
      >保存</button>
      <button
        onClick={onCancel}
        className="text-sm text-gray-600 dark:text-gray-400 px-2 py-0.5"
      >キャンセル</button>
      {err ? <span className="text-xs text-red-600 dark:text-red-400 w-full">{err}</span> : null}
    </div>
  );
}
