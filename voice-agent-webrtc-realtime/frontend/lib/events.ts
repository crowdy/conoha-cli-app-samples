import type { TickerEvent } from "@/lib/types";

/**
 * Subscribe to the backend's /api/events WebSocket. Reconnects with backoff.
 * Returns a cleanup function that closes the socket and stops reconnecting.
 */
export function subscribeEvents(
  onEvent: (event: TickerEvent) => void,
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 1000;

  function connect() {
    if (closed) return;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${window.location.host}/api/events`);

    ws.addEventListener("open", () => {
      backoff = 1000;
    });
    ws.addEventListener("message", (e) => {
      onEvent(JSON.parse(e.data) as TickerEvent);
    });
    ws.addEventListener("close", () => {
      if (closed) return;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 15000);
    });
  }

  connect();

  return () => {
    closed = true;
    ws?.close();
  };
}
