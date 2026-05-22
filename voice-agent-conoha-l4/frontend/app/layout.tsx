import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "voice-agent-conoha-l4",
  description: "Self-hosted WebRTC voice agent on ConoHa L4 GPU",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
