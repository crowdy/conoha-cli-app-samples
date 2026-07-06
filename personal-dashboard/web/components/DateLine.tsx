"use client";
import { useEffect, useState } from "react";

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

export function DateLine() {
  const [d, setD] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setD(new Date());
    update();
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, []);
  if (!d) return null;
  return (
    <div className="text-sm text-gray-600 dark:text-gray-400">
      {d.getFullYear()}年{d.getMonth() + 1}月{d.getDate()}日 {WEEKDAYS_JA[d.getDay()]}曜日
    </div>
  );
}
