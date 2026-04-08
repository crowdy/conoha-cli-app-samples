const API_BASE = "/api";

export async function fetchProducts() {
  const res = await fetch(`${API_BASE}/products`);
  return res.json();
}

export async function fetchManifest() {
  const res = await fetch("/.well-known/ucp");
  return res.json();
}

export async function createCheckoutSession(body: {
  buyer_email: string;
  line_items: { product_id: string; quantity: number }[];
  requested_capabilities?: string[];
}) {
  const res = await fetch(`${API_BASE}/checkout-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function getCheckoutSession(id: string) {
  const res = await fetch(`${API_BASE}/checkout-sessions/${id}`);
  return res.json();
}

export async function applyDiscount(id: string, discountCode: string) {
  const res = await fetch(`${API_BASE}/checkout-sessions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ discount_code: discountCode }),
  });
  return res.json();
}

export async function completePayment(
  id: string,
  handlerId: string,
  token: string
) {
  const res = await fetch(`${API_BASE}/checkout-sessions/${id}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payment: { handler_id: handlerId, token } }),
  });
  return res.json();
}
