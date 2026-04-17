import type { FC } from "hono/jsx";
import { Layout } from "./Layout.js";

interface DashboardProps {
  channels: Array<{ channelId: string; name: string; webhookUrl: string | null }>;
  totalMessages: number;
  totalWebhookDeliveries: number;
}

export const Dashboard: FC<DashboardProps> = ({
  channels,
  totalMessages,
  totalWebhookDeliveries,
}) => (
  <Layout title="Dashboard">
    <h2 class="text-2xl font-semibold mb-4">Dashboard</h2>
    <div class="grid grid-cols-3 gap-4 mb-6">
      <div class="bg-white rounded shadow p-4">
        <div class="text-sm text-slate-500">Channels</div>
        <div class="text-3xl font-bold">{channels.length}</div>
      </div>
      <div class="bg-white rounded shadow p-4">
        <div class="text-sm text-slate-500">Messages stored</div>
        <div class="text-3xl font-bold">{totalMessages}</div>
      </div>
      <div class="bg-white rounded shadow p-4">
        <div class="text-sm text-slate-500">Webhook deliveries</div>
        <div class="text-3xl font-bold">{totalWebhookDeliveries}</div>
      </div>
    </div>
    <h3 class="text-lg font-semibold mb-2">Channels</h3>
    <table class="w-full bg-white rounded shadow text-sm">
      <thead class="bg-slate-100">
        <tr>
          <th class="text-left p-2">Channel ID</th>
          <th class="text-left p-2">Name</th>
          <th class="text-left p-2">Webhook URL</th>
        </tr>
      </thead>
      <tbody>
        {channels.map((ch) => (
          <tr class="border-t">
            <td class="p-2 font-mono">{ch.channelId}</td>
            <td class="p-2">{ch.name}</td>
            <td class="p-2 font-mono text-xs">{ch.webhookUrl ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </Layout>
);
