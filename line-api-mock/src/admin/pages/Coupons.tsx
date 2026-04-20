import type { FC } from "hono/jsx";
import { Layout } from "./Layout.js";

export interface CouponRow {
  couponId: string;
  channelName: string;
  title: string;
  status: string;
  startTimestamp: number;
  endTimestamp: number;
  rewardSummary: string;
}

export interface ChannelOption {
  id: number;
  name: string;
}

export const Coupons: FC<{
  rows: CouponRow[];
  channels: ChannelOption[];
}> = ({ rows, channels }) => (
  <Layout title="Coupons">
    <h2 class="text-2xl font-semibold mb-4">Coupons</h2>

    <details class="bg-white rounded shadow p-4 mb-6">
      <summary class="cursor-pointer font-semibold">
        + New coupon (via admin shortcut)
      </summary>
      <form
        hx-post="/admin/coupons"
        hx-target="body"
        hx-swap="outerHTML"
        class="mt-3 grid grid-cols-2 gap-3"
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
          Title
          <input
            name="title"
            maxLength={60}
            required
            class="border p-2 rounded"
          />
        </label>
        <label class="flex flex-col text-sm col-span-2">
          Description
          <textarea name="description" maxLength={1000} class="border p-2 rounded" />
        </label>
        <label class="flex flex-col text-sm">
          Image URL
          <input name="imageUrl" type="url" class="border p-2 rounded" />
        </label>
        <label class="flex flex-col text-sm">
          Timezone
          <select name="timezone" class="border p-2 rounded" required>
            <option value="ASIA_TOKYO" selected>
              ASIA_TOKYO
            </option>
            <option value="ASIA_BANGKOK">ASIA_BANGKOK</option>
            <option value="ASIA_TAIPEI">ASIA_TAIPEI</option>
          </select>
        </label>
        <label class="flex flex-col text-sm">
          Start (ISO datetime)
          <input
            name="startTimestampIso"
            type="datetime-local"
            required
            class="border p-2 rounded"
          />
        </label>
        <label class="flex flex-col text-sm">
          End (ISO datetime)
          <input
            name="endTimestampIso"
            type="datetime-local"
            required
            class="border p-2 rounded"
          />
        </label>
        <label class="flex flex-col text-sm">
          Reward type
          <select name="rewardType" class="border p-2 rounded" required>
            <option value="discount" selected>
              discount
            </option>
            <option value="cashBack">cashBack</option>
            <option value="free">free</option>
            <option value="gift">gift</option>
            <option value="others">others</option>
          </select>
        </label>
        <label class="flex flex-col text-sm">
          Discount / cashback percent (1-99)
          <input
            name="percentage"
            type="number"
            min="1"
            max="99"
            value="10"
            class="border p-2 rounded"
          />
        </label>
        <button class="col-span-2 bg-green-600 text-white px-3 py-2 rounded">
          Create
        </button>
      </form>
    </details>

    <div class="bg-white rounded shadow overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-100">
          <tr>
            <th class="text-left p-2">Channel</th>
            <th class="text-left p-2">Title</th>
            <th class="text-left p-2">Reward</th>
            <th class="text-left p-2">Status</th>
            <th class="text-left p-2">Period</th>
            <th class="text-left p-2">couponId</th>
            <th class="text-left p-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr class="border-t">
              <td class="p-2">{r.channelName}</td>
              <td class="p-2">{r.title}</td>
              <td class="p-2">{r.rewardSummary}</td>
              <td class="p-2">
                <span
                  class={
                    r.status === "CLOSED"
                      ? "text-slate-500"
                      : "text-green-700 font-semibold"
                  }
                >
                  {r.status}
                </span>
              </td>
              <td class="p-2 text-xs font-mono">
                {new Date(r.startTimestamp * 1000).toISOString().slice(0, 16)}
                {" → "}
                {new Date(r.endTimestamp * 1000).toISOString().slice(0, 16)}
              </td>
              <td class="p-2 text-xs font-mono break-all">{r.couponId}</td>
              <td class="p-2">
                {r.status !== "CLOSED" && (
                  <form
                    hx-post={`/admin/coupons/${r.couponId}/close`}
                    hx-target="body"
                    hx-swap="outerHTML"
                    hx-confirm="Close this coupon?"
                  >
                    <button class="text-red-600 text-xs hover:underline">
                      Close
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Layout>
);
