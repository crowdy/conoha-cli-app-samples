import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitOps Demo",
  description: "Deployed via GitHub Actions + conoha app deploy",
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
