import type {
  Brand,
  Countdown,
  ScheduleItem,
  SectionEnvelope,
  Shortcut,
  Weather,
} from "./types";

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

export const api = {
  health:       () => getJSON<{ ok: boolean }>("/api/health"),
  weather:      () => getJSON<SectionEnvelope<Weather | null>>("/api/weather"),
  refreshWeather: () => fetch("/api/weather/refresh", { method: "POST" }),
  schedule:     (day: "today" | "tomorrow") =>
    getJSON<SectionEnvelope<ScheduleItem[]>>(`/api/schedule?day=${day}`),
  refreshSchedule: () => fetch("/api/schedule/refresh", { method: "POST" }),
  countdowns:   () => getJSON<Countdown[]>("/api/countdowns"),
  createCountdown: (target_at: string, label: string) =>
    fetch("/api/countdowns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_at, label }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<Countdown>;
    }),
  deleteCountdown: (id: number) =>
    fetch(`/api/countdowns/${id}`, { method: "DELETE" }),
  shortcuts:    () => getJSON<Shortcut[]>("/api/config/shortcuts"),
  brand:        () => getJSON<Brand>("/api/config/brand"),
};
