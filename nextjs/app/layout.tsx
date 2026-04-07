import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "conoha-cli Download Stats",
  description: "Download statistics for crowdy/conoha-cli GitHub releases",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
