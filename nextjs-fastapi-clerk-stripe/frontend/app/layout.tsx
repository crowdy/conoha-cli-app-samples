import { ClerkProvider, Show, UserButton } from "@clerk/nextjs";
import { jaJP } from "@clerk/localizations";
import type { Metadata } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "SaaS Demo - Clerk + Stripe",
  description: "Clerk認証とStripe決済のSaaSデモアプリ",
};

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold">
          SaaS Demo
        </Link>
        <nav className="flex items-center gap-4">
          <Button variant="ghost" render={<Link href="/pricing" />}>
            料金プラン
          </Button>
          <Show when="signed-in">
            <Button variant="ghost" render={<Link href="/dashboard" />}>
              ダッシュボード
            </Button>
            <UserButton />
          </Show>
          <Show when="signed-out">
            <Button variant="ghost" render={<Link href="/sign-in" />}>
              ログイン
            </Button>
            <Button render={<Link href="/sign-up" />}>無料で始める</Button>
          </Show>
        </nav>
      </div>
    </header>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      localization={jaJP}
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
    >
      <html lang="ja" className={cn("font-sans", geist.variable)}>
        <body className="min-h-screen flex flex-col bg-background">
          <Header />
          <main className="flex-1">{children}</main>
          <footer className="border-t py-6 text-center text-sm text-muted-foreground">
            SaaS Demo &middot; Deployed with conoha app deploy
          </footer>
        </body>
      </html>
    </ClerkProvider>
  );
}
