import { createClient } from "jsr:@supabase/supabase-js@2";

// Grow (Meshulam) server-to-server callback. Grow documents no signature, so we verify
// by matching the order id, the processToken we stored at creation, and the exact sum.
function nest(flat: Record<string, string>) {
  const out: any = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.replace(/\]/g, "").split("[");
    let o = out;
    parts.forEach((p, i) => { if (i === parts.length - 1) o[p] = v; else o = o[p] ??= {}; });
  }
  return out;
}

Deno.serve(async (req) => {
  const ok = () => new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return ok();

  let payload: any;
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("json")) payload = await req.json();
    else {
      const flat: Record<string, string> = {};
      (await req.formData()).forEach((v, k) => { flat[k] = String(v); });
      payload = nest(flat);
    }
  } catch (e) { console.error("unparseable callback", e); return ok(); }

  const d = payload?.data ?? payload ?? {};
  console.log("grow callback", JSON.stringify(payload)); // keep for sandbox verification, no card data is sent

  const orderId = d?.customFields?.cField1 ?? d?.cField1;
  const statusCode = String(d?.statusCode ?? "");
  const transactionId = String(d?.transactionId ?? "");
  if (!orderId || !transactionId) return ok();

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: order } = await sb.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) { console.error("unknown order", orderId); return ok(); }

  if (order.grow_process_token && String(d?.processToken ?? "") !== order.grow_process_token) {
    console.error("processToken mismatch for order", order.order_number); return ok();
  }
  if (Math.abs(Number(d?.sum) - Number(order.total)) > 0.01) {
    console.error("sum mismatch for order", order.order_number, d?.sum, order.total); return ok();
  }

  if (statusCode === "2") {
    const { data: changed, error } = await sb.rpc("mark_order_paid", { p_order_id: order.id, p_transaction_id: transactionId });
    if (error) { console.error("mark_order_paid failed", error); return new Response("retry", { status: 500 }); }
    console.log("order paid", order.order_number, "newly:", changed);
  } else {
    await sb.from("orders").update({ payment_status: "failed" }).eq("id", order.id).neq("payment_status", "paid");
  }

  // Acknowledge to Grow (best effort; the transaction is processed even if this fails).
  try {
    const base = Deno.env.get("GROW_API_BASE") ?? "https://sandbox.meshulam.co.il";
    const fd = new FormData();
    fd.set("pageCode", Deno.env.get("GROW_PAGE_CODE") ?? "");
    fd.set("transactionId", transactionId);
    if (d?.transactionToken) fd.set("transactionToken", String(d.transactionToken));
    if (d?.processId) fd.set("processId", String(d.processId));
    if (d?.processToken) fd.set("processToken", String(d.processToken));
    await fetch(`${base}/api/light/server/1.0/approveTransaction`, { method: "POST", body: fd });
  } catch (e) { console.error("approveTransaction failed", e); }

  return ok();
});
