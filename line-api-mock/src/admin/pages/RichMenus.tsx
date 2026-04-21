import type { FC } from "hono/jsx";
import { Layout } from "./Layout.js";

export interface RichMenuRow {
  richMenuId: string;
  channelDbId: number;
  channelName: string;
  name: string;
  chatBarText: string;
  size: { width: number; height: number };
  areaCount: number;
  hasImage: boolean;
  linkedUsers: number;
  isDefault: boolean;
}

export interface ChannelOption {
  id: number;
  name: string;
}

export interface VirtualUserOption {
  dbId: number;
  userIdStr: string;
  displayName: string;
  channelDbId: number;
}

export const RichMenus: FC<{
  rows: RichMenuRow[];
  channels: ChannelOption[];
  users: VirtualUserOption[];
}> = ({ rows, channels, users }) => (
  <Layout title="Rich Menus">
    <h2 class="text-2xl font-semibold mb-4">Rich Menus</h2>

    <details class="bg-white rounded shadow p-4 mb-6">
      <summary class="cursor-pointer font-semibold">
        + New rich menu (paste JSON)
      </summary>
      <form
        hx-post="/admin/richmenus"
        hx-target="body"
        hx-swap="outerHTML"
        class="mt-3 flex flex-col gap-3"
      >
        <label class="flex flex-col text-sm">
          Channel
          <select name="channelId" class="border p-2 rounded" required>
            {channels.map((c) => (
              <option value={String(c.id)}>{c.name}</option>
            ))}
          </select>
        </label>
        <label class="flex flex-col text-sm">
          RichMenuRequest JSON
          <textarea
            name="json"
            required
            rows={10}
            class="border p-2 rounded font-mono text-xs"
            placeholder='{"size":{"width":2500,"height":1686},"selected":false,"name":"Menu","chatBarText":"Tap","areas":[{"bounds":{"x":0,"y":0,"width":2500,"height":1686},"action":{"type":"postback","data":"a=1"}}]}'
          />
        </label>
        <button class="bg-green-600 text-white px-3 py-2 rounded">Create</button>
      </form>
    </details>

    <div class="bg-white rounded shadow overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-100">
          <tr>
            <th class="text-left p-2">Image</th>
            <th class="text-left p-2">Channel</th>
            <th class="text-left p-2">Name</th>
            <th class="text-left p-2">Size</th>
            <th class="text-left p-2">Areas</th>
            <th class="text-left p-2">Linked</th>
            <th class="text-left p-2">Default</th>
            <th class="text-left p-2">ID</th>
            <th class="text-left p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const channelUsers = users.filter(
              (u) => u.channelDbId === r.channelDbId
            );
            return (
              <tr class="border-t align-top">
                <td class="p-2">
                  {r.hasImage ? (
                    <a href={`/admin/richmenus/${r.richMenuId}/content`} target="_blank">
                      <img
                        src={`/admin/richmenus/${r.richMenuId}/content`}
                        alt=""
                        class="w-20 h-auto"
                      />
                    </a>
                  ) : (
                    <form
                      hx-post={`/admin/richmenus/${r.richMenuId}/upload`}
                      hx-target="body"
                      hx-swap="outerHTML"
                      hx-encoding="multipart/form-data"
                      class="flex flex-col gap-1"
                    >
                      <input
                        type="file"
                        name="image"
                        accept="image/png,image/jpeg"
                        required
                        class="text-xs"
                      />
                      <button class="text-xs bg-slate-700 text-white px-2 py-1 rounded">
                        Upload
                      </button>
                    </form>
                  )}
                </td>
                <td class="p-2 text-xs">{r.channelName}</td>
                <td class="p-2">{r.name}</td>
                <td class="p-2 text-xs">
                  {r.size.width}×{r.size.height}
                </td>
                <td class="p-2 text-xs">{r.areaCount}</td>
                <td class="p-2 text-xs">{r.linkedUsers}</td>
                <td class="p-2">
                  {r.isDefault ? (
                    <span class="text-green-700 font-semibold">●</span>
                  ) : (
                    <form
                      hx-post={`/admin/richmenus/${r.richMenuId}/set-default`}
                      hx-target="body"
                      hx-swap="outerHTML"
                    >
                      <button class="text-xs text-slate-600 hover:underline">
                        Set
                      </button>
                    </form>
                  )}
                </td>
                <td class="p-2 text-xs font-mono break-all">{r.richMenuId}</td>
                <td class="p-2">
                  <div class="flex flex-col gap-1">
                    <form
                      hx-post={`/admin/richmenus/${r.richMenuId}/link`}
                      hx-target="body"
                      hx-swap="outerHTML"
                      class="flex gap-1 text-xs"
                    >
                      <select name="virtualUserDbId" class="border rounded">
                        {channelUsers.map((u) => (
                          <option value={String(u.dbId)}>{u.displayName}</option>
                        ))}
                      </select>
                      <button class="text-green-700 hover:underline">Link</button>
                    </form>
                    <form
                      hx-delete={`/admin/richmenus/${r.richMenuId}`}
                      hx-confirm="Delete this rich menu?"
                      hx-target="body"
                      hx-swap="outerHTML"
                    >
                      <button class="text-red-600 text-xs hover:underline">
                        Delete
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </Layout>
);
