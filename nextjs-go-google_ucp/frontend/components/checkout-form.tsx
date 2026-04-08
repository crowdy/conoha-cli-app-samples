"use client";

import { useState } from "react";
import { useCart } from "./cart-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { createCheckoutSession, applyDiscount, completePayment } from "@/lib/api";

export function CheckoutForm() {
  const { items, totalCents, clearCart } = useCart();
  const [email, setEmail] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [discount, setDiscount] = useState(0);
  const [finalTotal, setFinalTotal] = useState(0);
  const [status, setStatus] = useState<"cart" | "created" | "complete">("cart");
  const [error, setError] = useState("");

  const handleCreateSession = async () => {
    setError("");
    const res = await createCheckoutSession({
      buyer_email: email,
      line_items: items.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
      })),
    });
    if (res.error) {
      setError(res.error);
      return;
    }
    setSessionId(res.id);
    setFinalTotal(res.total_cents);
    setStatus("created");
  };

  const handleApplyDiscount = async () => {
    if (!sessionId) return;
    const res = await applyDiscount(sessionId, discountCode);
    setDiscount(res.discount_cents);
    setFinalTotal(res.total_cents);
  };

  const handlePay = async () => {
    if (!sessionId) return;
    setError("");
    const res = await completePayment(sessionId, "mock_google_pay", "tok_demo");
    if (res.error) {
      setError(res.error);
      return;
    }
    setStatus("complete");
    clearCart();
  };

  if (items.length === 0 && status !== "complete") {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Your cart is empty.
        </CardContent>
      </Card>
    );
  }

  if (status === "complete") {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-2xl font-bold text-green-600">Payment Complete!</p>
          <p className="mt-2 text-muted-foreground">
            Session ID: <code className="text-xs">{sessionId}</code>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Checkout</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((item) => (
          <div key={item.product_id} className="flex justify-between">
            <span>
              {item.name} x {item.quantity}
            </span>
            <span>${((item.price_cents * item.quantity) / 100).toFixed(2)}</span>
          </div>
        ))}
        <div className="border-t pt-2 font-bold flex justify-between">
          <span>Subtotal</span>
          <span>${(totalCents / 100).toFixed(2)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-green-600">
            <span>Discount</span>
            <span>-${(discount / 100).toFixed(2)}</span>
          </div>
        )}
        {status === "created" && (
          <div className="border-t pt-2 font-bold flex justify-between text-lg">
            <span>Total</span>
            <span>${(finalTotal / 100).toFixed(2)}</span>
          </div>
        )}

        {status === "cart" && (
          <Input
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}

        {status === "created" && (
          <div className="flex gap-2">
            <Input
              placeholder="Discount code"
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value)}
            />
            <Button variant="outline" onClick={handleApplyDiscount}>
              Apply
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
      </CardContent>
      <CardFooter>
        {status === "cart" && (
          <Button className="w-full" onClick={handleCreateSession}>
            Create Checkout Session
          </Button>
        )}
        {status === "created" && (
          <Button className="w-full" onClick={handlePay}>
            Pay with Mock Google Pay
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
