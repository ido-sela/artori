import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  const c = body?.customer ?? {};
  const name = String(c.name ?? "").trim();
  const phone = String(c.phone ?? "").replace(/[^0-9]/g, "");
  const email = String(c.email ?? "").trim();
  const method = body?.shipping_method === "pickup" ? "pickup" : "delivery";
  if (name.split(/\s+/).length < 2) return json({ error: "invalid_name", message: "נא למלא שם פרטי ושם משפחה" }, 400);
  if (!/^05\d{8}$/.test(phone)) return json({ error: "invalid_phone", message: "נא להזין טלפון נייד תקין" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "invalid_email", message: "אימייל לא תקין" }, 400);
  if (method === "delivery" && (!String(c.city ?? "").trim() || !String(c.street ?? "").trim()))
    return json({ error: "invalid_address", message: "נא למלא עיר ורחוב" }, 400);

  const reqItems: { product_id: string; quantity: number }[] = Array.isArray(body?.items) ? body.items : [];
  if (!reqItems.length || reqItems.length > 50) return json({ error: "empty_cart" }, 400);
  for (const i of reqItems)
    if (typeof i.product_id !== "string" || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99)
      return json({ error: "bad_items" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Prices, stock and availability always come from the database, never from the client.
  const ids = [...new Set(reqItems.map((i) => i.product_id))];
  const { data: prods, error: pe } = await sb.from("products").select("*").in("id", ids).eq("is_active", true);
  if (pe) return json({ error: "db_error" }, 500);
  const byId = new Map((prods ?? []).map((p: any) => [p.id, p]));

  const qty = new Map<string, number>();
  for (const i of reqItems) qty.set(i.product_id, (qty.get(i.product_id) ?? 0) + i.quantity);

  const lines: any[] = [];
  let subtotal = 0;
  for (const [pid, q] of qty) {
    const p: any = byId.get(pid);
    if (!p) return json({ error: "product_unavailable", message: "אחד המוצרים כבר לא זמין" }, 409);
    if (p.stock_status === "out_of_stock" || (p.stock_qty != null && p.stock_qty < q))
      return json({ error: "out_of_stock", message: `"${p.name}" אזל מהמלאי` }, 409);
    const unit = Number(p.sale_price ?? p.price);
    subtotal += unit * q;
    lines.push({ product_id: p.id, name: p.name, sku: p.sku, image: (p.images ?? [])[0] ?? null, unit_price: unit, quantity: q });
  }

  const { data: ss } = await sb.from("site_settings").select("value").eq("key", "shipping").maybeSingle();
  const cfg: any = ss?.value ?? { delivery_fee: 35, free_over: 300 };
  const shipping = method === "pickup" ? 0 : subtotal >= Number(cfg.free_over ?? 1e9) ? 0 : Number(cfg.delivery_fee ?? 0);
  const total = Math.round((subtotal + shipping) * 100) / 100;

  const { data: order, error: oe } = await sb.from("orders").insert({
    customer_name: name, customer_phone: phone, customer_email: email,
    shipping_method: method === "pickup" ? "איסוף עצמי" : "משלוח",
    shipping_city: c.city ?? null, shipping_street: c.street ?? null, shipping_house: c.house ?? null,
    shipping_apartment: c.apartment ?? null, shipping_zip: c.zip ?? null,
    notes: body?.notes ? String(body.notes).slice(0, 1000) : null,
    subtotal, shipping_total: shipping, total,
  }).select().single();
  if (oe || !order) return json({ error: "db_error" }, 500);

  const { error: ie } = await sb.from("order_items").insert(lines.map((l) => ({ ...l, order_id: order.id })));
  if (ie) { await sb.from("orders").delete().eq("id", order.id); return json({ error: "db_error" }, 500); }

  // --- Grow (Meshulam) payment page ---
  const base = Deno.env.get("GROW_API_BASE") ?? "https://sandbox.meshulam.co.il";
  const site = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
  const fd = new FormData();
  fd.set("pageCode", Deno.env.get("GROW_PAGE_CODE") ?? "");
  fd.set("userId", Deno.env.get("GROW_USER_ID") ?? "");
  fd.set("sum", total.toFixed(2));
  fd.set("successUrl", `${site}/thank-you/?order=${order.order_number}`);
  fd.set("cancelUrl", `${site}/?payment=cancelled`);
  fd.set("description", `הזמנה ${order.order_number}`);
  fd.set("pageField[fullName]", name);
  fd.set("pageField[phone]", phone);
  fd.set("pageField[email]", email);
  fd.set("cField1", order.id);
  fd.set("notifyUrl", `${Deno.env.get("SUPABASE_URL")}/functions/v1/grow-notify`);

  let gj: any;
  try {
    const r = await fetch(`${base}/api/light/server/1.0/createPaymentProcess`, { method: "POST", body: fd });
    gj = await r.json();
  } catch (e) {
    console.error("grow request failed", e);
    return json({ error: "payment_unavailable", message: "שירות התשלום אינו זמין כרגע" }, 502);
  }
  const url = gj?.data?.url;
  if (!url) {
    console.error("grow bad response", JSON.stringify(gj));
    return json({ error: "payment_unavailable", message: "לא ניתן ליצור דף תשלום" }, 502);
  }
  await sb.from("orders").update({
    grow_process_id: gj.data.processId != null ? String(gj.data.processId) : null,
    grow_process_token: gj.data.processToken ?? null,
  }).eq("id", order.id);

  return json({ url, order_number: order.order_number });
});
