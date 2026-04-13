"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const plans = [
  {
    name: "Free",
    price: "¥0",
    period: "月",
    description: "個人利用に最適",
    features: ["基本機能", "メールサポート", "1 プロジェクト"],
    priceEnv: null as string | null,
  },
  {
    name: "Pro",
    price: "¥980",
    period: "月",
    description: "プロフェッショナル向け",
    features: ["全機能", "優先サポート", "無制限プロジェクト", "API アクセス"],
    priceEnv: "pro",
    popular: true,
  },
  {
    name: "Enterprise",
    price: "¥4,980",
    period: "月",
    description: "チーム・企業向け",
    features: [
      "全機能",
      "専用サポート",
      "無制限プロジェクト",
      "API アクセス",
      "チーム管理",
      "SLA 保証",
    ],
    priceEnv: "enterprise",
  },
];

export default function PricingPage() {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const router = useRouter();
  const [currentPlan, setCurrentPlan] = useState("free");
  const [submitting, setSubmitting] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/subscription", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setCurrentPlan(data.plan);
        }
      } catch {
        // keep free
      }
    })();
  }, [isLoaded, isSignedIn, getToken]);

  async function handleSubscribe(planEnv: string) {
    if (!isSignedIn) {
      router.push("/sign-up");
      return;
    }
    setSubmitting(planEnv);
    try {
      const token = await getToken();
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          price_id: planEnv,
          success_url: `${window.location.origin}/dashboard?success=true`,
          cancel_url: `${window.location.origin}/pricing`,
        }),
      });
      if (res.ok) {
        const { url } = await res.json();
        window.location.href = url;
      }
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <section className="py-20">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-center mb-2">料金プラン</h1>
        <p className="text-muted-foreground text-center mb-12">
          ビジネスの規模に合わせて最適なプランをお選びください
        </p>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan) => {
            const isCurrent = plan.name.toLowerCase() === currentPlan;
            return (
              <Card
                key={plan.name}
                className={plan.popular ? "ring-2 ring-primary" : ""}
              >
                <CardHeader className="relative">
                  {plan.popular && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                      人気
                    </Badge>
                  )}
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="mb-6">
                    <span className="text-4xl font-bold">{plan.price}</span>
                    <span className="text-muted-foreground">
                      /{plan.period}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-center gap-2 text-sm"
                      >
                        <span className="text-primary">✓</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  {isCurrent ? (
                    <Button variant="secondary" className="w-full" disabled>
                      現在のプラン
                    </Button>
                  ) : plan.priceEnv ? (
                    <Button
                      className="w-full"
                      disabled={submitting === plan.priceEnv}
                      onClick={() => handleSubscribe(plan.priceEnv!)}
                    >
                      {submitting === plan.priceEnv
                        ? "処理中..."
                        : "このプランを選択"}
                    </Button>
                  ) : (
                    <Button variant="secondary" className="w-full" disabled>
                      {currentPlan === "free"
                        ? "現在のプラン"
                        : "ダウングレード不可"}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
