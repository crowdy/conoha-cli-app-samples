// voice-agent-conoha-l4/frontend/components/OrderTicker.tsx
"use client";

import { useEffect, useState } from "react";
import type { Order } from "@/lib/types";

interface Event {
  type: "order_added" | "order_updated" | "order_closed";
  order?: Order;
  order_id?: string;
}

export function OrderTicker() {
  const [events, setEvents] = useState<Event[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const url = `${location.origin.replace(/^http/, "ws")}/api/events`;
    const ws = new WebSocket(url);
    ws.onopen = () => setConnected(true);
    ws.onmessage = (e) => {
      setEvents((prev) => [JSON.parse(e.data) as Event, ...prev].slice(0, 20));
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    return () => ws.close();
  }, []);

  return (
    <aside className="bg-zinc-900 rounded-xl p-4 w-full">
      <h3 className="text-sm font-semibold mb-2">
        リアルタイム業務イベント{" "}
        {connected ? (
          <span className="text-emerald-500">●</span>
        ) : (
          <span className="text-red-500" title="切断">●</span>
        )}
      </h3>
      <ul className="space-y-1 text-xs">
        {events.map((e, i) => (
          <li key={i} className="opacity-80">
            [{e.type}] {e.order?.order_id ?? e.order_id} {e.order ? `(${e.order.items.length} item)` : ""}
          </li>
        ))}
      </ul>
    </aside>
  );
}
