"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Shortcut } from "@/lib/types";

export function Shortcuts() {
  const [items, setItems] = useState<Shortcut[]>([]);

  useEffect(() => {
    api.shortcuts().then(setItems).catch(() => {});
  }, []);

  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-gray-800 dark:text-gray-200">SHORTCUTS</h2>
      <div className="grid grid-cols-8 gap-2">
        {items.map((s) => (
          <a
            key={s.label}
            href={s.url}
            target="_blank"
            rel="noopener"
            className="flex flex-col items-center gap-1 p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800"
          >
            <img src={s.icon} alt={s.label} className="w-8 h-8 object-contain" />
            <span className="text-[10px] text-gray-700 dark:text-gray-300">{s.label}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
