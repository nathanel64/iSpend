// iSpend
// deployed automatically from GitHub (.github/workflows/supabase.yml)
// iSpend: turns a question in plain Hebrew into a small query (Supabase Edge Function "ask-money").
// POST { q, cats, cards, today } -> { query: { intent, kind, category, card, words, from, to, period_label } }
// The AI gets the question and the names of the person's categories and cards. Never amounts, dates of purchases or businesses:
// the site counts the answer itself, on the phone.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const DAILY_CAP = 120;
const clean = (v: unknown, max = 40) => String(v ?? "").replace(/[<>"'`\\\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

async function ask(prompt: string): Promise<string> {
  const ak = Deno.env.get("ANTHROPIC_API_KEY"), gk = Deno.env.get("GEMINI_API_KEY");
  if (ak) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ak, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: Deno.env.get("AI_MODEL") || "claude-haiku-5-5", max_tokens: 400, messages: [{ role: "user", content: prompt }] }) });
    if (!r.ok) throw new Error("ai " + r.status);
    const j = await r.json(); return (j.content || []).map((c: { text?: string }) => c.text || "").join("");
  }
  if (!gk) throw new Error("no AI key");
  const models = [Deno.env.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-2.5-flash"].filter(Boolean) as string[];
  for (const model of models) {
    // no "thinking" step: a short JSON answer comes back several times faster
    const req = (h: Record<string, string>, think = false) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", ...h },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 300, ...(think ? {} : { thinkingConfig: { thinkingBudget: 0 } }) } }) });
    let r = await req({ "x-goog-api-key": gk });
    if (r.status === 400) r = await req({ "x-goog-api-key": gk }, true); // a model without that switch
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
  let body: { q?: string; cats?: string[]; cards?: string[]; today?: string } = {};
  try { body = await req.json(); } catch (e) { return json({ error: "bad request" }, 400); }
  const q = clean(body.q, 200); if (q.length < 2) return json({ error: "empty" }, 400);
  const cats = (Array.isArray(body.cats) ? body.cats : []).slice(0, 60).map(c => clean(c)).filter(Boolean);
  const cards = (Array.isArray(body.cards) ? body.cards : []).slice(0, 30).map(c => clean(c)).filter(Boolean);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(body.today)) ? String(body.today) : new Date().toISOString().slice(0, 10);
  // a daily cap per person
  const day = new Date().toISOString().slice(0, 10);
  const { data: use } = await sb.from("ask_usage").select("n").eq("user_id", u.user.id).eq("day", day).maybeSingle();
  if ((use?.n || 0) >= DAILY_CAP) return json({ error: "daily limit" }, 429);
  await sb.from("ask_usage").upsert({ user_id: u.user.id, day, n: (use?.n || 0) + 1 });
  const prompt = `אתה מנוע חיפוש לכסף: מתרגם שאלה בעברית על הוצאות והכנסות לשאילתה. היום ${today}. השבוע מתחיל ביום ראשון.
קטגוריות קיימות: ${cats.map(c => `"${c}"`).join(", ")}.
אמצעי תשלום קיימים: ${cards.map(c => `"${c}"`).join(", ")}.
החזר JSON בלבד בצורה:
{"intent":"sum|count|last|first|max|min|top_month|low_month|top_cat|top_merchant|avg_month|left|by_month|list","kind":"exp|inc","categories":["שמות קטגוריות מהרשימה בלבד, אחת או יותר, או ריק"],"card":"אמצעי תשלום מהרשימה או ריק","words":["מילים לחיפוש בשם העסק, בלי מילות שאלה ובלי שם קטגוריה"],"from":"YYYY-MM-DD או ריק","to":"YYYY-MM-DD או ריק","period_label":"תיאור קצר של התקופה בעברית"}
sum = כמה יצא/נכנס בסך הכל. count = כמה פעמים. last/first = מתי הפעם האחרונה/הראשונה. max/min = ההוצאה הכי גדולה/קטנה. top_month/low_month = באיזה חודש הכי הרבה/מעט. top_cat = על מה (איזו קטגוריה) הכי הרבה. top_merchant = באיזה עסק הכי הרבה. avg_month = ממוצע לחודש. left = כמה נשאר החודש. by_month = פירוט לפי חודשים. list = הצג/תראה לי את התנועות.
התאם מילים לקטגוריה הקרובה ביותר ברשימה, גם כשהניסוח שונה (למשל "קניות לבית" -> הקטגוריה שהכי מתאימה לקניות לבית; "אוכל בחוץ" -> מסעדות/אוכל ושתיה). אם מילה היא שם של עסק, שים אותה ב-words ולא בקטגוריה.
תקופות: "מפברואר 2026" = from 2026-02-01, to היום. "מאז מרץ" = מתחילת מרץ האחרון עד היום. "בין ינואר למאי" = 1 בינואר עד סוף מאי. "בפברואר" = כל פברואר. "ב-2025" = כל השנה. "השנה" = מ-1 בינואר השנה עד היום. "החודש" = מהיום הראשון של החודש הנוכחי עד היום. חודש בלי שנה = המופע האחרון שלו שלא בעתיד.
אם אין תקופה בשאלה, השאר from ו-to ריקים. period_label תמיד בצורה שמתאימה להתחלת משפט, למשל "מפברואר 2026 עד היום", "בספטמבר", "השנה".
השאלה: ${q}`;
  try {
    const text = await ask(prompt);
    const m = text.match(/\{[\s\S]*\}/); if (!m) return json({ error: "no answer" }, 502);
    const o = JSON.parse(m[0]);
    const date = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : "";
    const catList = (Array.isArray(o.categories) ? o.categories : [o.category]).map((c: unknown) => clean(c)).filter((c: string) => cats.includes(c)).slice(0, 6);
    return json({ query: { intent: clean(o.intent, 20), kind: o.kind === "inc" ? "inc" : "exp", category: catList[0] || "", categories: catList, card: cards.includes(clean(o.card)) ? clean(o.card) : "",
      words: (Array.isArray(o.words) ? o.words : []).map((w: unknown) => clean(w, 30)).filter(Boolean).slice(0, 4), from: date(o.from), to: date(o.to), period_label: clean(o.period_label, 30) } });
  } catch (e) { console.error("ask failed", e); return json({ error: /no AI key/.test(String((e as Error)?.message)) ? "no AI key" : "ai failed" }, 502); }
});
