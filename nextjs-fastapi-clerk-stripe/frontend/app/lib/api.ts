import { auth } from "@clerk/nextjs/server";

const API_BASE = "http://backend:8000/api";

async function fetchWithAuth(path: string, options: RequestInit = {}) {
  const { getToken } = await auth();
  const token = await getToken();

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json();
}

export async function getSubscription() {
  return fetchWithAuth("/subscription");
}

export async function createCheckoutSession(
  priceId: string,
  successUrl: string,
  cancelUrl: string
) {
  return fetchWithAuth("/checkout", {
    method: "POST",
    body: JSON.stringify({
      price_id: priceId,
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
  });
}

export async function createPortalSession(returnUrl: string) {
  return fetchWithAuth("/portal", {
    method: "POST",
    body: JSON.stringify({ return_url: returnUrl }),
  });
}
