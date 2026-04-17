import type { FC } from "hono/jsx";

export const Layout: FC<{ title: string; children?: unknown }> = ({
  title,
  children,
}) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} — line-api-mock</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://unpkg.com/htmx.org@2.0.4"></script>
    </head>
    <body class="bg-slate-50 text-slate-800">
      <header class="bg-green-600 text-white p-4">
        <div class="max-w-6xl mx-auto flex items-center gap-6">
          <h1 class="font-bold text-lg">line-api-mock</h1>
          <nav class="flex gap-4 text-sm">
            <a class="hover:underline" href="/admin">Dashboard</a>
            <a class="hover:underline" href="/admin/channels">Channels</a>
            <a class="hover:underline" href="/admin/users">Users</a>
            <a class="hover:underline" href="/admin/webhook-log">Webhooks</a>
            <a class="hover:underline" href="/admin/api-log">API Log</a>
            <a class="hover:underline" href="/docs" target="_blank">Swagger</a>
          </nav>
        </div>
      </header>
      <main class="max-w-6xl mx-auto p-6">{children}</main>
    </body>
  </html>
);
