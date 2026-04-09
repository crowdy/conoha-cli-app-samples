import { Elysia } from "elysia";
import { saveMessage } from "./db";

const nicknames = new Map<string, string>();

function getOnlineCount(): number {
  return nicknames.size;
}

export const wsRoutes = new Elysia().ws("/ws", {
  open(ws) {
    ws.subscribe("chat");
  },

  message(ws, raw) {
    const data =
      typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, unknown>);

    if (data.type === "join") {
      const nickname = String(data.nickname || "anonymous");
      nicknames.set(ws.id, nickname);
      const payload = JSON.stringify({
        type: "join",
        nickname,
        online: getOnlineCount(),
      });
      ws.send(payload);
      ws.publish("chat", payload);
    } else if (data.type === "message") {
      const nickname = nicknames.get(ws.id) || "anonymous";
      const content = String(data.content || "");
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
    const nickname = nicknames.get(ws.id) || "anonymous";
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
