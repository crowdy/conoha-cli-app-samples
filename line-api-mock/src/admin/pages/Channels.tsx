import type { FC } from "hono/jsx";
import { Layout } from "./Layout.js";

interface Row {
  id: number;
  channelId: string;
  channelSecret: string;
  name: string;
  webhookUrl: string | null;
  webhookEnabled: boolean;
  activeTokens: string[];
}

export const Channels: FC<{ channels: Row[] }> = ({ channels }) => (
  <Layout title="Channels">
    <h2 class="text-2xl font-semibold mb-4">Channels</h2>

    <details class="bg-white rounded shadow p-4 mb-6">
      <summary class="cursor-pointer font-semibold">+ New channel</summary>
      <form
        hx-post="/admin/channels"
        hx-target="body"
        hx-swap="outerHTML"
        class="mt-3 flex flex-col gap-2"
      >
        <input name="name" placeholder="Name" required class="border p-2 rounded" />
        <button class="bg-green-600 text-white px-3 py-2 rounded">Create</button>
      </form>
    </details>

    <div class="space-y-4">
      {channels.map((ch) => (
        <div class="bg-white rounded shadow p-4" data-pk={ch.id}>
          <div class="flex justify-between">
            <div>
              <div class="font-semibold">{ch.name}</div>
              <div class="text-xs font-mono text-slate-500">{ch.channelId}</div>
            </div>
            <form
              hx-delete={`/admin/channels/${ch.id}`}
              hx-confirm="Delete this channel?"
              hx-target="body"
              hx-swap="outerHTML"
            >
              <button class="text-red-600 text-sm hover:underline">Delete</button>
            </form>
          </div>
          <div class="grid grid-cols-2 gap-4 mt-3 text-sm">
            <div>
              <div class="text-slate-500">Channel Secret</div>
              <div class="font-mono break-all">{ch.channelSecret}</div>
            </div>
            <div>
              <div class="text-slate-500">Active Access Tokens</div>
              {ch.activeTokens.length === 0 ? (
                <div class="text-slate-400">(none)</div>
              ) : (
                ch.activeTokens.map((t) => (
                  <div class="font-mono break-all">{t}</div>
                ))
              )}
              <form
                hx-post={`/admin/channels/${ch.id}/token`}
                hx-target="body"
                hx-swap="outerHTML"
              >
                <button class="mt-1 text-green-700 text-xs hover:underline">
                  + Issue token
                </button>
              </form>
            </div>
          </div>
          <form
            hx-put={`/admin/channels/${ch.id}/webhook`}
            hx-target="body"
            hx-swap="outerHTML"
            class="mt-3 flex gap-2 text-sm"
          >
            <input
              name="webhookUrl"
              placeholder="https://your-bot/webhook"
              value={ch.webhookUrl ?? ""}
              class="border p-2 rounded flex-1 font-mono"
            />
            <label class="flex items-center gap-1">
              <input
                type="checkbox"
                name="enabled"
                checked={ch.webhookEnabled}
              />{" "}
              enabled
            </label>
            <button class="bg-slate-800 text-white px-3 py-1 rounded">Save</button>
          </form>
        </div>
      ))}
    </div>
  </Layout>
);
