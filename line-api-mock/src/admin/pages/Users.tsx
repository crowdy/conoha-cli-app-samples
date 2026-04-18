import type { FC } from "hono/jsx";
import { Layout } from "./Layout.js";

interface UserRow {
  id: number;
  userId: string;
  displayName: string;
  language: string;
}

export const Users: FC<{ users: UserRow[] }> = ({ users }) => (
  <Layout title="Users">
    <h2 class="text-2xl font-semibold mb-4">Virtual Users</h2>
    <details class="bg-white rounded shadow p-4 mb-6">
      <summary class="cursor-pointer font-semibold">+ New user</summary>
      <form
        hx-post="/admin/users"
        hx-target="body"
        hx-swap="outerHTML"
        class="mt-3 flex gap-2"
      >
        <input name="displayName" placeholder="Display name" required class="border p-2 rounded flex-1" />
        <input name="language" placeholder="ja" value="ja" class="border p-2 rounded w-20" />
        <button class="bg-green-600 text-white px-3 py-2 rounded">Create</button>
      </form>
    </details>
    <table class="w-full bg-white rounded shadow text-sm">
      <thead class="bg-slate-100">
        <tr>
          <th class="text-left p-2">User ID</th>
          <th class="text-left p-2">Display name</th>
          <th class="text-left p-2">Lang</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr class="border-t">
            <td class="p-2 font-mono text-xs">{u.userId}</td>
            <td class="p-2">{u.displayName}</td>
            <td class="p-2">{u.language}</td>
            <td class="p-2 text-right">
              <form
                hx-delete={`/admin/users/${u.id}`}
                hx-confirm="Delete user?"
                hx-target="body"
                hx-swap="outerHTML"
              >
                <button class="text-red-600 hover:underline">Delete</button>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </Layout>
);
