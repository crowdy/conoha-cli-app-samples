"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimulatorStep } from "./simulator-step";
import {
  fetchManifest,
  fetchProducts,
  createCheckoutSession,
  applyDiscount,
  completePayment,
} from "@/lib/api";

interface Product {
  id: string;
  name: string;
  price_cents: number;
}

export function CheckoutSimulator() {
  const [currentStep, setCurrentStep] = useState(1);
  const [products, setProducts] = useState<Product[]>([]);

  // Step 1: Discovery
  const [manifestReq, setManifestReq] = useState<{ method: string; url: string } | null>(null);
  const [manifestRes, setManifestRes] = useState<unknown>(null);

  // Step 2: Negotiation
  const [selectedCaps, setSelectedCaps] = useState<string[]>([
    "dev.ucp.shopping.checkout",
    "dev.ucp.shopping.discount",
  ]);
  const [negotiationResult, setNegotiationResult] = useState<unknown>(null);

  // Step 3: Create Session
  const [selectedProduct, setSelectedProduct] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("demo@example.com");
  const [createReq, setCreateReq] = useState<{ method: string; url: string; body: unknown } | null>(null);
  const [createRes, setCreateRes] = useState<Record<string, unknown> | null>(null);

  // Step 4: Discount
  const [discountCode, setDiscountCode] = useState("SPRING10");
  const [discountReq, setDiscountReq] = useState<{ method: string; url: string; body: unknown } | null>(null);
  const [discountRes, setDiscountRes] = useState<unknown>(null);

  // Step 5: Payment
  const [paymentToken, setPaymentToken] = useState("tok_demo_success");
  const [payReq, setPayReq] = useState<{ method: string; url: string; body: unknown } | null>(null);
  const [payRes, setPayRes] = useState<unknown>(null);

  useEffect(() => {
    fetchProducts().then((p: Product[]) => {
      setProducts(p);
      if (p.length > 0) setSelectedProduct(p[0].id);
    });
  }, []);

  const handleDiscovery = async () => {
    setManifestReq({ method: "GET", url: "/.well-known/ucp" });
    const res = await fetchManifest();
    setManifestRes(res);
    setCurrentStep(2);
  };

  const handleNegotiation = () => {
    const allCaps = [
      { name: "dev.ucp.shopping.checkout", extends: "" },
      { name: "dev.ucp.shopping.discount", extends: "dev.ucp.shopping.checkout" },
    ];
    const active = allCaps.filter((c) => {
      if (!selectedCaps.includes(c.name)) return false;
      if (c.extends && !selectedCaps.includes(c.extends)) return false;
      return true;
    });
    setNegotiationResult({
      requested: selectedCaps,
      active: active.map((c) => c.name),
    });
    setCurrentStep(3);
  };

  const handleCreateSession = async () => {
    const body = {
      buyer_email: buyerEmail,
      line_items: [{ product_id: selectedProduct, quantity: 1 }],
      requested_capabilities: selectedCaps,
    };
    setCreateReq({
      method: "POST",
      url: "/api/checkout-sessions",
      body,
    });
    const res = await createCheckoutSession(body);
    setCreateRes(res);
    setCurrentStep(4);
  };

  const handleDiscount = async () => {
    const sessionId = createRes?.id as string;
    const body = { discount_code: discountCode };
    setDiscountReq({
      method: "PUT",
      url: `/api/checkout-sessions/${sessionId}`,
      body,
    });
    const res = await applyDiscount(sessionId, discountCode);
    setDiscountRes(res);
    setCurrentStep(5);
  };

  const handlePayment = async () => {
    const sessionId = createRes?.id as string;
    const body = {
      payment: { handler_id: "mock_google_pay", token: paymentToken },
    };
    setPayReq({
      method: "POST",
      url: `/api/checkout-sessions/${sessionId}/complete`,
      body,
    });
    const res = await completePayment(sessionId, "mock_google_pay", paymentToken);
    setPayRes(res);
  };

  const toggleCap = (name: string) => {
    setSelectedCaps((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]
    );
  };

  return (
    <div className="space-y-4">
      <SimulatorStep
        step={1}
        title="Discovery"
        description="AI agent fetches the merchant's UCP manifest to discover capabilities."
        request={manifestReq ?? undefined}
        response={manifestRes ?? undefined}
        active={currentStep >= 1}
      >
        <Button onClick={handleDiscovery} disabled={currentStep > 1}>
          Fetch Manifest
        </Button>
      </SimulatorStep>

      <SimulatorStep
        step={2}
        title="Negotiation"
        description="Agent declares which capabilities it supports. Server computes the intersection."
        response={negotiationResult ?? undefined}
        active={currentStep >= 2}
      >
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selectedCaps.includes("dev.ucp.shopping.checkout")}
              onChange={() => toggleCap("dev.ucp.shopping.checkout")}
            />
            dev.ucp.shopping.checkout
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selectedCaps.includes("dev.ucp.shopping.discount")}
              onChange={() => toggleCap("dev.ucp.shopping.discount")}
            />
            dev.ucp.shopping.discount (extends checkout)
          </label>
          <Button
            onClick={handleNegotiation}
            disabled={currentStep < 2 || currentStep > 2}
            size="sm"
          >
            Negotiate
          </Button>
        </div>
      </SimulatorStep>

      <SimulatorStep
        step={3}
        title="Create Session"
        description="Agent creates a checkout session with selected products."
        request={createReq ?? undefined}
        response={createRes ?? undefined}
        active={currentStep >= 3}
      >
        <div className="space-y-2">
          <select
            className="w-full rounded border p-2 text-sm"
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (${(p.price_cents / 100).toFixed(2)})
              </option>
            ))}
          </select>
          <Input
            value={buyerEmail}
            onChange={(e) => setBuyerEmail(e.target.value)}
            placeholder="Buyer email"
          />
          <Button
            onClick={handleCreateSession}
            disabled={currentStep < 3 || currentStep > 3}
            size="sm"
          >
            Create Checkout Session
          </Button>
        </div>
      </SimulatorStep>

      <SimulatorStep
        step={4}
        title="Apply Discount (Optional)"
        description="Agent applies a discount code to the session."
        request={discountReq ?? undefined}
        response={discountRes ?? undefined}
        active={currentStep >= 4}
      >
        <div className="flex gap-2">
          <Input
            value={discountCode}
            onChange={(e) => setDiscountCode(e.target.value)}
            placeholder="Discount code"
          />
          <Button
            onClick={handleDiscount}
            disabled={currentStep < 4 || currentStep > 4}
            size="sm"
          >
            Apply
          </Button>
          <Button
            variant="outline"
            onClick={() => setCurrentStep(5)}
            disabled={currentStep !== 4}
            size="sm"
          >
            Skip
          </Button>
        </div>
      </SimulatorStep>

      <SimulatorStep
        step={5}
        title="Complete Payment"
        description='Agent submits mock payment token. Use "fail" to simulate declined payment.'
        request={payReq ?? undefined}
        response={payRes ?? undefined}
        active={currentStep >= 5}
      >
        <div className="flex gap-2">
          <Input
            value={paymentToken}
            onChange={(e) => setPaymentToken(e.target.value)}
            placeholder="Payment token"
          />
          <Button onClick={handlePayment} disabled={currentStep < 5} size="sm">
            Pay
          </Button>
        </div>
      </SimulatorStep>
    </div>
  );
}
