"use client";

import { MODE_STYLES } from "@/components/ModeTheme";
import type { Order } from "@/lib/types";

export function OrderTicker({ orders }: { orders: Order[] }) {
  return (
    <section className="rounded-lg bg-black/20 p-4">
      <h2 className="mb-2 text-sm font-bold opacity-70">📡 他のお客様 (ライブ)</h2>
      {orders.length === 0 ? (
        <p className="text-sm opacity-40">まだ他の注文はありません</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {orders.map((order) => (
            <li key={order.order_id} className="flex items-center gap-2 text-sm">
              <span>{MODE_STYLES[order.mode].emoji}</span>
              <span className="opacity-70">
                {order.customer_label || "お客様"}:
              </span>
              <span>
                {order.items.map((i) => `${i.name}×${i.qty}`).join(", ")}
              </span>
              {order.status === "closed" && (
                <span className="opacity-50">(確定)</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
