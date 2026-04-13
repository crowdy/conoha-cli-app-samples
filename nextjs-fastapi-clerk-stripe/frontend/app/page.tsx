import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="py-24 bg-muted/30">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            ビジネスを加速する SaaS プラットフォーム
          </h1>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Clerk 認証と Stripe
            決済を統合した、モダンな SaaS アプリケーションのデモです。
          </p>
          <div className="flex gap-3 justify-center">
            <Button size="lg" render={<Link href="/sign-up" />}>
              無料で始める
            </Button>
            <Button size="lg" variant="outline" render={<Link href="/pricing" />}>
              料金プランを見る
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-center mb-12">主な機能</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <Card>
              <CardContent>
                <div className="text-3xl mb-3">&#x1f510;</div>
                <h3 className="font-semibold mb-2">セキュアな認証</h3>
                <p className="text-sm text-muted-foreground">
                  Clerk
                  による安全なログイン・会員登録。ソーシャルログインにも対応。
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <div className="text-3xl mb-3">&#x1f4b3;</div>
                <h3 className="font-semibold mb-2">簡単な決済</h3>
                <p className="text-sm text-muted-foreground">
                  Stripe Checkout
                  による安全な決済。日本円でのサブスクリプション管理。
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <div className="text-3xl mb-3">&#x1f680;</div>
                <h3 className="font-semibold mb-2">即座にデプロイ</h3>
                <p className="text-sm text-muted-foreground">
                  conoha app deploy でワンコマンドデプロイ。Docker Compose
                  で簡単運用。
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </>
  );
}
