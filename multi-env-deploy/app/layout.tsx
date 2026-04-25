import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Multi-env Deploy Demo",
  description: "Branch-routed staging vs. production deploys via conoha app deploy",
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
