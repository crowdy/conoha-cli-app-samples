import type { FC } from "hono/jsx";
import { Layout } from "./Layout.js";

interface Msg {
  id: number;
  direction: "bot_to_user" | "user_to_bot";
  type: string;
  payload: any;
  createdAt: string;
}

interface ConversationProps {
  channelId: number;
  virtualUserId: number;
  channelName: string;
  userName: string;
  messages: Msg[];
}

export const Conversation: FC<ConversationProps> = ({
  channelId,
  virtualUserId,
  channelName,
  userName,
  messages,
}) => (
  <Layout title={`${channelName} ↔ ${userName}`}>
    <h2 class="text-xl font-semibold mb-2">
      {channelName} ↔ {userName}
    </h2>
    <div
      id="messages"
      class="bg-white rounded shadow p-4 h-96 overflow-y-auto flex flex-col gap-2"
      hx-ext="sse"
      sse-connect={`/admin/events?scope=conversation&channel=${channelId}&user=${virtualUserId}`}
      sse-swap="message"
      hx-swap="beforeend"
    >
      {messages.map((m) => (
        <div
          class={
            m.direction === "user_to_bot"
              ? "self-end bg-green-100 px-3 py-2 rounded-lg max-w-sm"
              : "self-start bg-slate-200 px-3 py-2 rounded-lg max-w-sm"
          }
        >
          <div class="text-xs text-slate-500 mb-1">
            {m.direction === "user_to_bot" ? userName : channelName} · {m.type}
          </div>
          <div class="font-mono text-xs whitespace-pre-wrap">
            {JSON.stringify(m.payload)}
          </div>
        </div>
      ))}
    </div>

    <form
      hx-post={`/admin/conversations/${channelId}/${virtualUserId}/send`}
      hx-target="body"
      hx-swap="outerHTML"
      class="mt-4 flex gap-2"
    >
      <input
        name="text"
        placeholder="User says…"
        required
        class="border p-2 rounded flex-1"
      />
      <button class="bg-green-600 text-white px-4 py-2 rounded">Send as user</button>
    </form>
    <p class="text-xs text-slate-500 mt-2">
      Sends a LINE-format webhook event to the channel's configured URL. The bot's reply will appear above.
    </p>
  </Layout>
);
