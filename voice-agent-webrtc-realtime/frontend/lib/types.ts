export type Mode = "emergency" | "military" | "callcenter";
export type Language = "ja" | "en" | "ko";

export interface OrderItem {
  name: string;
  qty: number;
  note?: string | null;
}

export interface Order {
  order_id: string;
  created_at: string;
  mode: Mode;
  customer_label?: string | null;
  items: OrderItem[];
  language: Language;
  status: "open" | "closed";
  notes?: string | null;
}

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  done: boolean;
}

export interface TickerEvent {
  type: "order_added" | "order_updated" | "order_closed";
  payload: Order;
}

export const MODES: Mode[] = ["emergency", "military", "callcenter"];

export function isMode(value: string | null): value is Mode {
  return value === "emergency" || value === "military" || value === "callcenter";
}
