"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function Brand() {
  const [label, setLabel] = useState<string>("");
  useEffect(() => {
    api.brand().then((b) => setLabel(b.label)).catch(() => {});
  }, []);
  return (
    <div className="text-lg tracking-widest text-gray-700 dark:text-gray-300">
      {label || " "}
    </div>
  );
}
