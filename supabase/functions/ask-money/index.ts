// iSpend
// deployed automatically from GitHub (.github/workflows/supabase.yml)
// iSpend: turns a question in plain Hebrew into a small query (Supabase Edge Function "ask-money").
// POST { q, cats, cards, today, merchants, summary } -> { query: { intent, kind, category, card, words, from, to, period_label, answer } }
// With the person's consent the AI also gets the names of their businesses, a summary per month and category, and the purchases
// of the last two months. Questions that can be counted come back as a query, and the site counts them on the phone;
// open questions (why, where to save, what changed) come back as a short written answer ("advice").
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
      body: JSON.stringify({ model: Deno.env.get("AI_MODEL") || "claude-haiku-5-5", max_tokens: 900, messages: [{ role: "user", content: prompt }] }) });
    if (!r.ok) throw new Error("ai " + r.status);
    const j = await r.json(); return (j.content || []).map((c: { text?: string }) => c.text || "").join("");
  }
  if (!gk) throw new Error("no AI key");
  // the newest Flash (free); a short think first, so dates and comparisons come out right
  const models = [Deno.env.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"].filter(Boolean) as string[];
  for (const model of models) {
    // a short "thinking" step before the JSON answer: dates, comparisons and open questions come out right
    const req = (h: Record<string, string>, think = false) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", ...h },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 2000, ...(think ? {} : { thinkingConfig: { thinkingBudget: 768 } }) } }) });
    let r = await req({ "x-goog-api-key": gk });
    if (r.status === 400) r = await req({ "x-goog-api-key": gk }, true); // a model without that switch
    if (r.status === 401 || r.status === 403) { const r2 = await req({ Authorization: "Bearer " + gk }); if (r2.ok) r = r2; }
    if (r.ok) { const j = await r.json(); return j.candidates?.[0]?.content?.parts?.map((p: { text?: string; thought?: boolean }) => p.thought ? "" : p.text || "").join("") || ""; }
    if (![404, 429, 500, 503].includes(r.status)) throw new Error("ai " + r.status);
  }
  throw new Error("ai model");
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user) return json({ error: "not signed in" }, 401);
  let body: { q?: string; cats?: string[]; cards?: string[]; today?: string; merchants?: string[]; summary?: string; history?: { q?: string; a?: string }[]; mode?: string; target?: string; goal?: number; income?: number; plan_cats?: string[] } = {};
  try { body = await req.json(); } catch (e) { return json({ error: "bad request" }, 400); }
  const isPlan = body.mode === "plan";
  const q = isPlan ? "plan" : clean(body.q, 200); if (q.length < 2) return json({ error: "empty" }, 400);
  const cats = (Array.isArray(body.cats) ? body.cats : []).slice(0, 60).map(c => clean(c)).filter(Boolean);
  const cards = (Array.isArray(body.cards) ? body.cards : []).slice(0, 30).map(c => clean(c)).filter(Boolean);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(body.today)) ? String(body.today) : new Date().toISOString().slice(0, 10);
  const merchants = (Array.isArray(body.merchants) ? body.merchants : []).slice(0, 300).map(m => clean(m, 50)).filter(Boolean);
  const summary = String(body.summary || "").replace(/[<>`\\]/g, " ").slice(0, 60000);
  const history = (Array.isArray(body.history) ? body.history : []).slice(-4).map(h => ({ q: clean(h?.q, 200), a: clean(h?.a, 400) })).filter(h => h.q);
  // a daily cap per person
  const day = new Date().toISOString().slice(0, 10);
  const { data: use } = await sb.from("ask_usage").select("n").eq("user_id", u.user.id).eq("day", day).maybeSingle();
  if ((use?.n || 0) >= DAILY_CAP) return json({ error: "daily limit" }, 429);
  await sb.from("ask_usage").upsert({ user_id: u.user.id, day, n: (use?.n || 0) + 1 });
  if (isPlan) {
    const target = /^\d{4}-\d{2}$/.test(String(body.target)) ? String(body.target) : "";
    const pcats = (Array.isArray(body.plan_cats) ? body.plan_cats : []).slice(0, 40).map(c => clean(c)).filter(c => cats.includes(c));
    const goal = Math.max(0, Math.round(+body.goal || 0)), income = Math.max(0, Math.round(+body.income || 0));
    if (!target || !pcats.length) return json({ error: "bad request" }, 400);
    const pp = `אתה יועץ תקציב אישי. הצע תקרה חודשית לכל קטגוריה של הוצאות משתנות לחודש ${target}.
הכנסה צפויה: ${income || "לא ידוע"}. יעד חיסכון: ${goal || "לא הוגדר"}.
קטגוריות לתכנון: ${pcats.map(c => `"${c}"`).join(", ")}.
עקרונות: מבוסס על מה שבאמת יצא בחודשים האחרונים (לא חודש חריג אחד); ריאלי, לא פחות מבערך 60% מהממוצע; קצץ קודם בקטגוריות שעלו או שאפשר לוותר בהן (בילויים, אוכל בחוץ, קניות), ופחות בבסיסיות (סופר, דלק, בריאות); אם יש יעד, נסה שהכנסה פחות הקבועות פחות סכום התקרות תשאיר לפחות את היעד; עגל ל-50.
החזר JSON בלבד: {"caps":{"שם קטגוריה":סכום},"note":"משפט אחד או שניים בעברית: מה הרעיון של התוכנית ואיפה העיקר"}
הנתונים:
${summary}`;
    try {
      const text = await ask(pp);
      const m = text.match(/\{[\s\S]*\}/); if (!m) return json({ error: "no answer" }, 502);
      const o = JSON.parse(m[0]), caps: Record<string, number> = {};
      Object.entries(o.caps || {}).forEach(([c, v]) => { const k = clean(c); const n = Math.round((+v || 0) / 50) * 50; if (pcats.includes(k) && n > 0 && n < 1e6) caps[k] = n; });
      return json({ plan: { caps, note: String(o.note || "").replace(/[<>`]/g, "").trim().slice(0, 400) } });
    } catch (e) { console.error("plan failed", e); return json({ error: "ai failed" }, 502); }
  }
  const prompt = `אתה מנוע חיפוש לכסף: מתרגם שאלה בעברית על הוצאות והכנסות לשאילתה. היום ${today}. השבוע מתחיל ביום ראשון.
קטגוריות קיימות: ${cats.map(c => `"${c}"`).join(", ")}.
אמצעי תשלום קיימים: ${cards.map(c => `"${c}"`).join(", ")}.
החזר JSON בלבד בצורה:
{"intent":"sum|count|last|first|max|min|top_month|low_month|top_cat|top_merchant|avg_month|left|by_month|list|avg|compare|pct_income|weekday|advice","answer":"רק ב-advice: התשובה בעברית, אחרת ריק","unit":"day|week|month|tx או ריק","kind":"exp|inc","categories":["שמות קטגוריות מהרשימה בלבד, אחת או יותר, או ריק"],"card":"אמצעי תשלום מהרשימה או ריק","words":["מילים לחיפוש בשם העסק, בלי מילות שאלה ובלי שם קטגוריה"],"from":"YYYY-MM-DD או ריק","to":"YYYY-MM-DD או ריק","period_label":"תיאור קצר של התקופה בעברית","from2":"YYYY-MM-DD או ריק","to2":"YYYY-MM-DD או ריק","period2_label":"תיאור התקופה השנייה בהשוואה"}
sum = כמה יצא/נכנס בסך הכל. count = כמה פעמים. last/first = מתי הפעם האחרונה/הראשונה. max/min = ההוצאה הכי גדולה/קטנה. top_month/low_month = באיזה חודש הכי הרבה/מעט. top_cat = על מה (איזו קטגוריה) הכי הרבה. top_merchant = באיזה עסק הכי הרבה. avg_month = ממוצע לחודש. left = כמה נשאר החודש. by_month = פירוט לפי חודשים. list = הצג/תראה לי את התנועות. avg = ממוצע ליום/לשבוע/לחודש/לפעם (unit בהתאם; "בממוצע לקנייה" = tx). compare = השוואה בין שתי תקופות (from/to = הראשונה, from2/to2 = השנייה; "החודש לעומת החודש שעבר", "ספטמבר מול אוקטובר"; אם הוזכרה רק תקופה אחת, השנייה היא התקופה המקבילה שלפניה). pct_income = כמה אחוז מההכנסה/מהמשכורת. weekday = באיזה יום בשבוע הכי הרבה.
advice = שאלה פתוחה שאי אפשר לענות עליה בספירה אחת: למה החודש יקר, איפה אפשר לחסוך, מה השתנה, האם אני בסדר, המלצה, הסבר. ב-advice כתוב ב-answer תשובה קצרה (2–5 משפטים), חמה וישירה, בגוף שני, עם מספרים מדויקים מהנתונים בלבד (בש"ח, עם ₪ ופסיקים), בלי להמציא ובלי לחשב סכומים ארוכים בעצמך: השתמש בסיכומים החודשיים המוכנים. אם אין מספיק נתונים, אמור זאת.
כל שאלה שאפשר לספור (כמה, מתי, כמה פעמים, הכי הרבה, ממוצע, השוואה) תחזיר כשאילתה רגילה ולא כ-advice.
עסקים קיימים (שם ומספר פעמים): ${merchants.join(", ")}.
כששואלים על עסק, שים ב-words את שמו כפי שהוא מופיע ברשימת העסקים (גם כשנכתב אחרת, בכתיב אחר או בקיצור).
התאם מילים לקטגוריה הקרובה ביותר ברשימה, גם כשהניסוח שונה (למשל "קניות לבית" -> הקטגוריה שהכי מתאימה לקניות לבית; "אוכל בחוץ" -> מסעדות/אוכל ושתיה). אם מילה היא שם של עסק, שים אותה ב-words ולא בקטגוריה.
תקופות: "מפברואר 2026" = from 2026-02-01, to היום. "מאז מרץ" = מתחילת מרץ האחרון עד היום. "בין ינואר למאי" = 1 בינואר עד סוף מאי. "בפברואר" = כל פברואר. "ב-2025" = כל השנה. "השנה" = מ-1 בינואר השנה עד היום. "החודש" = מהיום הראשון של החודש הנוכחי עד היום. חודש בלי שנה = המופע האחרון שלו שלא בעתיד.
אם אין תקופה בשאלה, השאר from ו-to ריקים. period_label תמיד בצורה שמתאימה להתחלת משפט, למשל "מפברואר 2026 עד היום", "בספטמבר", "השנה".
${summary ? "הנתונים של המשתמש:\n" + summary + "\n" : ""}${history.length ? "השיחה עד עכשיו (השאלה החדשה יכולה להמשיך אותה: \"ולעומת ספטמבר?\", \"ומה עם דלק?\", \"איך מורידים את זה?\" — השלם ממנה את מה שחסר: קטגוריה, עסק, תקופה):\n" + history.map(h => "שאלה: " + h.q + "\nתשובה: " + h.a).join("\n") + "\n" : ""}השאלה: ${q}`;
  try {
    const text = await ask(prompt);
    const m = text.match(/\{[\s\S]*\}/); if (!m) return json({ error: "no answer" }, 502);
    const o = JSON.parse(m[0]);
    const date = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : "";
    const catList = (Array.isArray(o.categories) ? o.categories : [o.category]).map((c: unknown) => clean(c)).filter((c: string) => cats.includes(c)).slice(0, 6);
    return json({ query: { intent: clean(o.intent, 20), kind: o.kind === "inc" ? "inc" : "exp", category: catList[0] || "", categories: catList, unit: ["day", "week", "month", "tx"].includes(o.unit) ? o.unit : "", from2: date(o.from2), to2: date(o.to2), period2_label: clean(o.period2_label, 30), card: cards.includes(clean(o.card)) ? clean(o.card) : "",
      words: (Array.isArray(o.words) ? o.words : []).map((w: unknown) => clean(w, 30)).filter(Boolean).slice(0, 4), from: date(o.from), to: date(o.to), period_label: clean(o.period_label, 30),
      answer: o.intent === "advice" ? String(o.answer || "").replace(/[<>`]/g, "").trim().slice(0, 700) : "" } });
  } catch (e) { console.error("ask failed", e); return json({ error: /no AI key/.test(String((e as Error)?.message)) ? "no AI key" : "ai failed" }, 502); }
});
