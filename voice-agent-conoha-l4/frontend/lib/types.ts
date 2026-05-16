// voice-agent-conoha-l4/frontend/lib/types.ts
export type Mode = "emergency" | "military" | "callcenter";
export type Language = "ja" | "en" | "ko";
export type OrderStatus = "pending" | "persisted" | "closed" | "error";

export interface OrderItem {
  name: string;
  qty: number;
  note?: string | null;
}

export interface Order {
  order_id: string;
  mode: Mode;
  language: Language;
  customer_label: string | null;
  items: OrderItem[];
  notes: string | null;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
}

export const MODES: { mode: Mode; emoji: string; label: string }[] = [
  { mode: "emergency",  emoji: "🚑", label: "救急センター" },
  { mode: "military",   emoji: "🪖", label: "作戦司令部" },
  { mode: "callcenter", emoji: "☎️", label: "コールセンター" },
];
