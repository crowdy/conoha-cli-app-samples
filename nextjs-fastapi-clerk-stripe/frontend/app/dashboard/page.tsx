"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const planLabels: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  enterprise: "Enterprise",
};

const statusLabels: Record<string, string> = {
  active: "有効",
  trialing: "トライアル中",
  past_due: "支払い遅延",
  canceled: "解約済み",
};

type Sub = { plan: string; status: string; current_period_end: string | null };

function DashboardContent() {
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const success = searchParams.get("success");

  const [sub, setSub] = useState<Sub>({
    plan: "free",
    status: "active",
    current_period_end: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/subscription", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setSub(await res.json());
      } catch {
        // fallback to free
      } finally {
        setLoading(false);
      }
    })();
  }, [isLoaded, isSignedIn, getToken, router]);

  async function handleManageSubscription() {
    const token = await getToken();
    const res = await fetch("/api/portal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        return_url: `${window.location.origin}/dashboard`,
      }),
    });
    if (res.ok) {
      const { url } = await res.json();
      window.location.href = url;
    }
  }

  if (!isLoaded || loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 text-center text-muted-foreground">
        読み込み中...
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4">
      <h1 className="text-2xl font-bold mb-8">ダッシュボード</h1>

      {success && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 mb-6 text-sm">
          サブスクリプションの登録が完了しました！
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>サブスクリプション情報</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center py-3 border-b">
            <span className="text-muted-foreground">アカウント</span>
            <span>{user?.primaryEmailAddress?.emailAddress}</span>
          </div>

          <div className="flex justify-between items-center py-3 border-b">
            <span className="text-muted-foreground">現在のプラン</span>
            <span className="font-semibold text-lg">
              {planLabels[sub.plan] || sub.plan}
            </span>
          </div>

          <div className="flex justify-between items-center py-3 border-b">
            <span className="text-muted-foreground">ステータス</span>
            <Badge variant={sub.status === "active" ? "default" : "secondary"}>
              {statusLabels[sub.status] || sub.status}
            </Badge>
          </div>

          {sub.current_period_end && (
            <div className="flex justify-between items-center py-3 border-b">
              <span className="text-muted-foreground">次回請求日</span>
              <span>
                {new Date(sub.current_period_end).toLocaleDateString("ja-JP")}
              </span>
            </div>
          )}

          <div className="pt-4">
            {sub.plan === "free" ? (
              <Button render={<Link href="/pricing" />}>
                プランをアップグレード
              </Button>
            ) : (
              <Button variant="outline" onClick={handleManageSubscription}>
                サブスクリプション管理
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <section className="py-12">
      <Suspense
        fallback={
          <div className="max-w-2xl mx-auto px-4 text-center text-muted-foreground">
            読み込み中...
          </div>
        }
      >
        <DashboardContent />
      </Suspense>
    </section>
  );
}
