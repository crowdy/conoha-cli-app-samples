import { Elysia } from "elysia";
import { saveMessage } from "./db";

const MAX_NICKNAME_LEN = 32;
const MAX_CONTENT_LEN = 2000;

// In-memory map of WebSocket id -> nickname. This state lives only in this
// process, so a single replica is assumed. For multi-replica deployments,
// track presence in Redis or another shared store instead.
const nicknames = new Map<string, string>();

function getOnlineCount(): number {
  return nicknames.size;
}

function parseFrame(raw: unknown): Record<string, unknown> | null {
  try {
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    }
    if (typeof raw === "object" && raw !== null) {
      return raw as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function sanitizeNickname(value: unknown): string {
  const s = String(value ?? "").trim().slice(0, MAX_NICKNAME_LEN);
  return s || "anonymous";
}

function sanitizeContent(value: unknown): string {
  return String(value ?? "").slice(0, MAX_CONTENT_LEN).trim();
}

export const wsRoutes = new Elysia().ws("/ws", {
  open(ws) {
    ws.subscribe("chat");
  },

  message(ws, raw) {
    const data = parseFrame(raw);
    if (!data || typeof data.type !== "string") return;

    if (data.type === "join") {
      const nickname = sanitizeNickname(data.nickname);
      nicknames.set(ws.id, nickname);
      const payload = JSON.stringify({
        type: "join",
        nickname,
        online: getOnlineCount(),
      });
      ws.send(payload);
      ws.publish("chat", payload);
      return;
    }

    if (data.type === "message") {
      const nickname = nicknames.get(ws.id) || "anonymous";
      const content = sanitizeContent(data.content);
      if (!content) return;
      const saved = saveMessage(nickname, content);
      const payload = JSON.stringify({
        type: "message",
        id: saved.id,
        nickname: saved.nickname,
        content: saved.content,
        createdAt: saved.created_at,
      });
      ws.send(payload);
      ws.publish("chat", payload);
    }
  },

  close(ws) {
    const nickname = nicknames.get(ws.id);
    if (!nickname) return;
    nicknames.delete(ws.id);
    ws.publish(
      "chat",
      JSON.stringify({
        type: "leave",
        nickname,
        online: getOnlineCount(),
      })
    );
  },
});
