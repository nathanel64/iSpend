// iSpend: names and sorts businesses the site does not know (Supabase Edge Function "classify-merchant").
// POST { names: [raw...], cats: [...] }      -> { results: { raw: { name, cat } } }   (from the shared memory, else the AI)
// POST { learn: [{ raw, name, cat }] }        -> a person's own correction, kept for everyone
// The AI gets only the business names, never amounts or dates.
// Needs one secret: ANTHROPIC_API_KEY (Claude) or GEMINI_API_KEY (Google, free tier).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
// the same key the site uses: lower case, no digits or punctuation
export const keyOf = (s: string) => String(s || "").toLowerCase().replace(/[0-9*#_.,'"()\/\\|:;!?+\-]+/g, " ").replace(/\s+/g, " ").trim();
const UNSORTED = "לא מסווג";

async function askAI(names: string[], cats: string[]): Promise<{ name: string; cat: string }[]> {
  const prompt = `אלה שמות של בתי עסק כפי שהם מופיעים בפירוט של כרטיס אשראי או חשבון בנק בישראל.
לכל שם החזר:
- name: שם קריא וקצר של העסק, כמו שאנשים קוראים לו (לרשת מוכרת: השם המוכר, למשל "SHUFERSAL DEAL" ← "שופרסל דיל", "WOLT" ← "וולט"). בלי בע"מ, בלי מספרי סניף. אם אינך יודע, החזר את השם המקורי מסודר.
- cat: הקטגוריה המתאימה ביותר מתוך הרשימה בלבד: ${cats.map(c => `"${c}"`).join(", ")}. אם אינך בטוח, "${UNSORTED}".
החזר JSON בלבד: מערך באותו סדר, [{"i":0,"name":"...","cat":"..."}].
השמות:
${names.map((n, i) => `${i}. ${n}`).join("\n")}`;
  let text = "";
  const ak = Deno.env.get("ANTHROPIC_API_KEY"), gk = Deno.env.get("GEMINI_API_KEY");
  if (ak) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": ak, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: Deno.env.get("AI_MODEL") || "claude-haiku-5-5", max_tokens: 4000, messages: [{ role: "user", content: prompt }] })
    });
    if (!r.ok) throw new Error("claude " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json(); text = (j.content || []).map((c: { text?: string }) => c.text || "").join("");
  } else if (gk) {
    // the newest fast model first (the alias follows Google's releases), older names as a fallback
    const models = [Deno.env.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-2.5-flash"].filter(Boolean) as string[];
    let r: Response | null = null, last = "";
    for (const model of models) {
      // the key goes in a header: both the older "AIza…" keys and the newer "AQ.…" ones are accepted there
      const req = (h: Record<string, string>) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", headers: { "content-type": "application/json", ...h },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } })
      });
      r = await req({ "x-goog-api-key": gk });
      if (r.status === 401 || r.status === 403) { const r2 = await req({ Authorization: "Bearer " + gk }); if (r2.ok) r = r2; }
      if (r.ok) break; last = model + " " + r.status + " " + (await r.text()).slice(0, 160); if (r.status !== 404) break;
    }
    if (!r || !r.ok) throw new Error("gemini " + last);
    const j = await r.json(); text = j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
  } else throw new Error("no AI key");
  const m = text.match(/\[[\s\S]*\]/); if (!m) return [];
  const arr = JSON.parse(m[0]) as { i: number; name: string; cat: string }[];
  const out: { name: string; cat: string }[] = names.map(n => ({ name: n, cat: UNSORTED }));
  for (const x of arr) if (Number.isInteger(x.i) && x.i >= 0 && x.i < names.length) {
    out[x.i] = { name: String(x.name || names[x.i]).trim().slice(0, 40) || names[x.i], cat: cats.includes(x.cat) ? x.cat : UNSORTED };
  }
  return out;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user) return json({ error: "not signed in" }, 401);
  let body: { names?: string[]; cats?: string[]; learn?: { raw: string; name: string; cat: string }[] } = {};
  try { body = await req.json(); } catch (_) { /* empty */ }

  if (Array.isArray(body.learn)) {
    const rows = body.learn.slice(0, 20).filter(x => x && x.raw && keyOf(x.raw)).map(x => ({ raw_key: keyOf(x.raw), raw: String(x.raw).slice(0, 120), name: String(x.name || "").slice(0, 40), cat: String(x.cat || "").slice(0, 40), source: "user", updated_at: new Date().toISOString() }));
    if (rows.length) await sb.from("merchant_cache").upsert(rows);
    return json({ ok: rows.length });
  }

  const names = [...new Set((body.names || []).map(n => String(n || "").trim()).filter(Boolean))].slice(0, 60);
  const cats = (body.cats || []).map(String).filter(c => c && c !== "הכנסה").slice(0, 60);
  if (!names.length) return json({ results: {} });
  const keys = names.map(keyOf);
  const { data: hits } = await sb.from("merchant_cache").select("raw_key, name, cat").in("raw_key", keys);
  const byKey = new Map((hits || []).map(h => [h.raw_key, h]));
  const results: Record<string, { name: string; cat: string }> = {};
  const missing: string[] = [];
  names.forEach((n, i) => { const h = byKey.get(keys[i]); if (h) results[n] = { name: h.name || n, cat: h.cat || UNSORTED }; else if (keys[i]) missing.push(n); });
  if (missing.length) {
    try {
      const ans = await askAI(missing, cats.length ? cats : ["סופר", "אוכל ושתיה", "קניות", "תחבורה ודלק", "בילויים", "הוצאות שוטפות"]);
      const rows = missing.map((n, i) => ({ raw_key: keyOf(n), raw: n.slice(0, 120), name: ans[i].name, cat: ans[i].cat, source: "ai", updated_at: new Date().toISOString() }));
      await sb.from("merchant_cache").upsert(rows, { onConflict: "raw_key", ignoreDuplicates: true });
      missing.forEach((n, i) => { results[n] = ans[i]; });
    } catch (e) { return json({ results, error: String((e as Error).message || e).slice(0, 200) }); }
  }
  return json({ results });
});
