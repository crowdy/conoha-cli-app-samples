import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Posts App",
  description: "Next.js + FastAPI + PostgreSQL sample app",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 min-h-screen">
        <header className="bg-white border-b">
          <div className="max-w-3xl mx-auto px-4 py-4">
            <a href="/" className="text-xl font-bold text-gray-900">
              Posts App
            </a>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
