import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChatOps Deploy Demo",
  description: "Deployed by typing /deploy in a PR comment",
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
