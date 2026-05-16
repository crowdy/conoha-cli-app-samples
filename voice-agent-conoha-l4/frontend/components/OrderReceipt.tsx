// voice-agent-conoha-l4/frontend/components/OrderReceipt.tsx
"use client";

import type { OrderItem } from "@/lib/types";

interface Props {
  items: OrderItem[];
  status: "idle" | "pending" | "persisted" | "closed" | "error";
  orderId: string | null;
}

export function OrderReceipt({ items, status, orderId }: Props) {
  return (
    <div className="bg-zinc-900 rounded-xl p-4">
      <header className="flex justify-between text-sm opacity-70">
        <span>受注票</span>
        <span>{orderId ?? "(未発行)"}</span>
      </header>
      <ul className="mt-2 space-y-1">
        {items.length === 0 && <li className="opacity-50 italic">まだ注文がありません</li>}
        {items.map((it, i) => (
          <li key={i} className="flex justify-between">
            <span>{it.name}</span><span>×{it.qty}</span>
          </li>
        ))}
      </ul>
      <footer className="mt-3 text-xs opacity-70">状態: {status}</footer>
    </div>
  );
}
