import type { FC } from "hono/jsx";
import { Layout } from "./Layout.js";

interface Row {
  id: number;
  method: string;
  path: string;
  responseStatus: number;
  durationMs: number;
  createdAt: string;
}

export const ApiLog: FC<{ rows: Row[] }> = ({ rows }) => (
  <Layout title="API Log">
    <h2 class="text-2xl font-semibold mb-4">API Requests</h2>
    <table class="w-full bg-white rounded shadow text-sm">
      <thead class="bg-slate-100">
        <tr>
          <th class="text-left p-2">When</th>
          <th class="text-left p-2">Method</th>
          <th class="text-left p-2">Path</th>
          <th class="text-left p-2">Status</th>
          <th class="text-left p-2">Duration</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr class="border-t">
            <td class="p-2 text-xs">{r.createdAt}</td>
            <td class="p-2">{r.method}</td>
            <td class="p-2 font-mono text-xs">{r.path}</td>
            <td class="p-2">{r.responseStatus}</td>
            <td class="p-2">{r.durationMs}ms</td>
          </tr>
        ))}
      </tbody>
    </table>
  </Layout>
);
