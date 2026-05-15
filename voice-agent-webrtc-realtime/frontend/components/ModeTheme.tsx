import type { Mode } from "@/lib/types";

export interface ModeStyle {
  label: string;
  emoji: string;
  /** Tailwind classes for the page background + base text. */
  page: string;
  /** Tailwind classes for the mode badge. */
  badge: string;
  /** Tailwind classes for the push-to-talk button. */
  button: string;
  /** Font family utility class. */
  font: string;
}

export const MODE_STYLES: Record<Mode, ModeStyle> = {
  emergency: {
    label: "注文救急センター",
    emoji: "🚑",
    page: "bg-red-950 text-red-50",
    badge: "bg-red-600 text-white",
    button: "bg-red-600 hover:bg-red-500 text-white",
    font: "font-mono",
  },
  military: {
    label: "注文作戦司令部",
    emoji: "🪖",
    page: "bg-green-950 text-yellow-50",
    badge: "bg-green-700 text-yellow-100",
    button: "bg-green-700 hover:bg-green-600 text-yellow-100",
    font: "font-mono",
  },
  callcenter: {
    label: "注文コールセンター",
    emoji: "☎️",
    page: "bg-white text-slate-900",
    badge: "bg-blue-900 text-white",
    button: "bg-blue-900 hover:bg-blue-800 text-white",
    font: "font-sans",
  },
};

export function ModeBadge({ mode }: { mode: Mode }) {
  const style = MODE_STYLES[mode];
  return (
    <div className={`inline-flex items-center gap-2 rounded px-3 py-1 text-sm font-bold ${style.badge}`}>
      <span>{style.emoji}</span>
      <span>{style.label}</span>
    </div>
  );
}
