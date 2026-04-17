import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "メンバー招待",
  description: "メンバーに招待メールを送信します",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
