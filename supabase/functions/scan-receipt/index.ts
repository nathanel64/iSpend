// iSpend
// deployed automatically from GitHub (.github/workflows/supabase.yml)
// iSpend: reads a photo of a receipt (Supabase Edge Function "scan-receipt").
// POST { image (base64 JPEG), cats, today } -> { merchant, amount, date, category }
// The photo goes to the AI for this one reading and is not kept anywhere.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const DAILY_CAP = 40;
const MAX_B64 = 4_000_000; // about 3MB of picture; the site sends far less
const clean = (v: unknown, max = 40) => String(v ?? "").replace(/[<>"'`\\\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

async function read(image: string, prompt: string): Promise<string> {
  const ak = Deno.env.get("ANTHROPIC_API_KEY"), gk = Deno.env.get("GEMINI_API_KEY");
  if (ak) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ak, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: Deno.env.get("AI_MODEL") || "claude-haiku-5-5", max_tokens: 300, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } }, { type: "text", text: prompt }] }] }) });
    if (!r.ok) throw new Error("ai " + r.status);
    const j = await r.json(); return (j.content || []).map((c: { text?: string }) => c.text || "").join("");
  }
  if (!gk) throw new Error("no AI key");
  const models = [Deno.env.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-2.5-flash"].filter(Boolean) as string[];
  for (const model of models) {
    const req = (h: Record<string, string>, think = false) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", ...h },
      body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: "image/jpeg", data: image } }, { text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 300, ...(think ? {} : { thinkingConfig: { thinkingBudget: 0 } }) } }) });
    let r = await req({ "x-goog-api-key": gk });
    if (r.status === 400) r = await req({ "x-goog-api-key": gk }, true);
    if (r.status === 401 || r.status === 403) { const r2 = await req({ Authorization: "Bearer " + gk }); if (r2.ok) r = r2; }
    if (r.ok) { const j = await r.json(); return j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || ""; }
    if (r.status !== 404) throw new Error("ai " + r.status);
  }
  throw new Error("ai model");
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user) return json({ error: "not signed in" }, 401);
  let body: { image?: string; cats?: string[]; today?: string } = {};
  try { body = await req.json(); } catch (_) { return json({ error: "bad request" }, 400); }
  const image = String(body.image || "");
  if (image.length < 1000 || image.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(image)) return json({ error: "bad image" }, 400);
  const cats = (Array.isArray(body.cats) ? body.cats : []).slice(0, 60).map(c => clean(c)).filter(Boolean);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(body.today)) ? String(body.today) : new Date().toISOString().slice(0, 10);
  const day = new Date().toISOString().slice(0, 10);
  const { data: use } = await sb.from("scan_usage").select("n").eq("user_id", u.user.id).eq("day", day).maybeSingle();
  if ((use?.n || 0) >= DAILY_CAP) return json({ error: "daily limit" }, 429);
  await sb.from("scan_usage").upsert({ user_id: u.user.id, day, n: (use?.n || 0) + 1 });
  const prompt = `זו תמונה של קבלה או חשבונית (לרוב בעברית, בישראל). היום ${today}.
החזר JSON בלבד: {"merchant":"שם העסק, קצר וברור כמו שאנשים קוראים לו, בלי ח.פ ובלי סניף","amount":הסכום הסופי ששולם כמספר (סה"כ לתשלום, אחרי הנחות),"date":"YYYY-MM-DD או ריק אם לא מופיע","category":"אחת מהרשימה או ריק"}
קטגוריות: ${cats.map(c => `"${c}"`).join(", ")}.
אם זו לא קבלה, החזר {"merchant":"","amount":0,"date":"","category":""}.`;
  try {
    const text = await read(image, prompt);
    const m = text.match(/\{[\s\S]*\}/); if (!m) return json({ error: "no answer" }, 502);
    const o = JSON.parse(m[0]);
    const amount = Math.round(Math.abs(parseFloat(String(o.amount ?? "0").replace(/[^\d.]/g, ""))) * 100) / 100 || 0;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(o.date || "")) && String(o.date) <= today ? String(o.date) : "";
    const category = cats.includes(clean(o.category)) ? clean(o.category) : "";
    return json({ merchant: clean(o.merchant, 40), amount: amount > 0 && amount < 1e6 ? amount : 0, date, category });
  } catch (e) { console.error("scan failed", e); return json({ error: /no AI key/.test(String((e as Error)?.message)) ? "no AI key" : "ai failed" }, 502); }
});
