import type { FC } from "hono/jsx";
import { Layout } from "./Layout.js";

interface Row {
  id: number;
  targetUrl: string;
  statusCode: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

export const WebhookLog: FC<{ rows: Row[] }> = ({ rows }) => (
  <Layout title="Webhook Log">
    <h2 class="text-2xl font-semibold mb-4">Webhook Deliveries</h2>
    <table class="w-full bg-white rounded shadow text-sm">
      <thead class="bg-slate-100">
        <tr>
          <th class="text-left p-2">When</th>
          <th class="text-left p-2">Status</th>
          <th class="text-left p-2">Target</th>
          <th class="text-left p-2">Duration</th>
          <th class="text-left p-2">Error</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr class="border-t">
            <td class="p-2 text-xs">{r.createdAt}</td>
            <td class="p-2">{r.statusCode ?? "—"}</td>
            <td class="p-2 font-mono text-xs">{r.targetUrl}</td>
            <td class="p-2">{r.durationMs ?? "—"}ms</td>
            <td class="p-2 text-red-600 text-xs">{r.error ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </Layout>
);
