export type ColorState = "normal" | "yellow" | "blink" | "red";

const MIN = 60_000;
const HOUR = 60 * MIN;

export function timeColorState(remainingMs: number): ColorState {
  if (remainingMs <= 0) return "red";
  if (remainingMs <= 10 * MIN) return "blink";
  if (remainingMs <= HOUR) return "yellow";
  return "normal";
}

export function formatRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return "終了";
  const totalMinutes = Math.floor(remainingMs / MIN);
  if (totalMinutes >= 60) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}時間${m}分`;
  }
  return `${totalMinutes}分`;
}
