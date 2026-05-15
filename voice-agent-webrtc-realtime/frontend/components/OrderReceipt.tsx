"use client";

import type { ReceiptOrder } from "@/lib/tools";

export function OrderReceipt({ order }: { order: ReceiptOrder | null }) {
  if (!order) {
    return (
      <section className="rounded-lg bg-black/20 p-4">
        <h2 className="mb-2 text-sm font-bold opacity-70">📝 ご注文</h2>
        <p className="text-sm opacity-40">まだ注文がありません</p>
      </section>
    );
  }

  const statusLabel = {
    pending: "保存中…",
    persisted: "✓ 記録済",
    closed: "✓ 確定済",
    error: "⚠️ 保存失敗、再試行中",
  }[order.status];

  return (
    <section className="rounded-lg bg-black/20 p-4">
      <h2 className="mb-2 text-sm font-bold opacity-70">📝 ご注文</h2>
      <ul className="flex flex-col gap-1">
        {order.items.map((item, idx) => (
          <li key={`${item.name}-${idx}`} className="flex justify-between text-sm">
            <span>
              {item.name}
              {item.note ? ` (${item.note})` : ""}
            </span>
            <span className="font-bold">× {item.qty}</span>
          </li>
        ))}
      </ul>
      <div
        className={`mt-2 text-right text-xs ${
          order.status === "error" ? "text-red-400" : "opacity-60"
        }`}
      >
        {statusLabel}
      </div>
    </section>
  );
}
