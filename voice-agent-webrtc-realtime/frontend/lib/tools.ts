import { sendEvent, type RealtimeSession } from "@/lib/realtime";
import type { Mode, Order, OrderItem } from "@/lib/types";

/** A receipt line as shown in OrderReceipt, with persistence state. */
export interface ReceiptOrder {
  order_id: string | null; // null until the backend assigns one
  items: OrderItem[];
  status: "pending" | "persisted" | "closed" | "error";
}

export interface ToolContext {
  mode: Mode;
  /** Optimistically update the receipt before the backend responds. */
  onOptimistic: (items: OrderItem[]) => void;
  /** Backend assigned/persisted an order id. */
  onPersisted: (order: Order) => void;
  onClosed: (order: Order) => void;
  onError: (message: string) => void;
}

interface FunctionCallEvent {
  type: string;
  name: string;
  call_id: string;
  arguments: string; // JSON string
}

function isFunctionCallDone(event: Record<string, unknown>): boolean {
  return event.type === "response.function_call_arguments.done";
}

/**
 * Handle a Realtime data-channel event. If it is a function call, execute it
 * against the backend HTTP API and return the result to the model via a
 * function_call_output item + response.create.
 *
 * Returns true if the event was a (handled) function call.
 */
export async function handleToolEvent(
  session: RealtimeSession,
  event: Record<string, unknown>,
  ctx: ToolContext,
): Promise<boolean> {
  if (!isFunctionCallDone(event)) return false;
  const call = event as unknown as FunctionCallEvent;
  const args = JSON.parse(call.arguments) as Record<string, unknown>;

  let output: Record<string, unknown>;
  try {
    output = await dispatch(call.name, args, ctx);
  } catch (err) {
    ctx.onError(String(err));
    output = { ok: false, error: String(err) };
  }

  sendEvent(session, {
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: call.call_id,
      output: JSON.stringify(output),
    },
  });
  sendEvent(session, { type: "response.create" });
  return true;
}

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  if (name === "add_order") {
    const items = args.items as OrderItem[];
    ctx.onOptimistic(items); // instant UI update, no Sheets round-trip
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: ctx.mode,
        customer_label: (args.customer_label as string) ?? null,
        language: args.language,
        items,
      }),
    });
    if (!res.ok) throw new Error(`add_order failed: ${res.status}`);
    const order = (await res.json()) as Order;
    ctx.onPersisted(order);
    return { ok: true, order_id: order.order_id };
  }

  if (name === "update_order") {
    const res = await fetch(`/api/orders/${args.order_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: args.items,
        notes: (args.notes as string) ?? null,
      }),
    });
    if (!res.ok) throw new Error(`update_order failed: ${res.status}`);
    const order = (await res.json()) as Order;
    ctx.onPersisted(order);
    return { ok: true, order_id: order.order_id };
  }

  if (name === "close_order") {
    const res = await fetch(`/api/orders/${args.order_id}/close`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`close_order failed: ${res.status}`);
    const order = (await res.json()) as Order;
    ctx.onClosed(order);
    return { ok: true, order_id: order.order_id, status: "closed" };
  }

  if (name === "list_orders") {
    const limit = (args.limit as number) ?? 10;
    const res = await fetch(`/api/orders/recent?limit=${limit}`);
    if (!res.ok) throw new Error(`list_orders failed: ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  throw new Error(`unknown tool: ${name}`);
}
