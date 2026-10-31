// iSpend
// deployed automatically from GitHub (.github/workflows/supabase.yml)
// iSpend: evening reminders (Supabase Edge Function "ispend-push").
// GET  ?vapid=1  -> the public key the phone subscribes with (the key pair is made on first use and kept in push_keys)
// POST ?test=1   -> a test push to the signed-in user
// POST (every 15 minutes, from cron) -> at each person's chosen time (Israel time, 21:00 if not chosen), a reminder if nothing was added that day
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function keys() {
  const { data } = await sb.from("push_keys").select("public_key, private_key, cron_secret").eq("id", 1).maybeSingle();
  if (data) return data;
  const k = webpush.generateVAPIDKeys();
  await sb.from("push_keys").upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey });
  const again = await sb.from("push_keys").select("public_key, private_key, cron_secret").eq("id", 1).single();
  return again.data!;
}
function israelNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  const hour = +p.hour % 24, minute = +p.minute;
  return { day: `${p.year}-${p.month}-${p.day}`, hour, mins: hour * 60 + minute, sinceMidnight: new Date(Date.now() - (hour * 60 + minute) * 60000) };
}
// only real push services (Apple, Google, Mozilla, Microsoft) get a message
const PUSH_HOST = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com|[a-z0-9.-]+\.push\.apple\.com)\//;
// the Sunday that opened the week which just ended (Israel weeks run Sunday to Saturday)
function lastSunday(day: string) { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - d.getUTCDay() - 7); return d.toISOString().slice(0, 10); }
const shek = (v: number) => "₪" + Math.round(v).toLocaleString("en-US");
// the phone sends its own numbers when the site is open; if they are not for last week, the message stays general
function weeklyMsg(s: { week_stats?: unknown }, ws: string) {
  const st = s.week_stats as Record<string, { ws?: string; total?: number; ptotal?: number; top?: string }> | null;
  const w = st && [st.prev, st.cur].find(x => x && x.ws === ws);
  if (!w || typeof w.total !== "number") return { title: "הסיכום השבועי מוכן 📊", body: "לחיצה פותחת את הסיכום של השבוע שעבר.", url: "./?week", tag: "ispend-week" };
  const d = (w.total || 0) - (w.ptotal || 0), cmp = w.ptotal ? (Math.abs(d) < 20 ? "בערך כמו השבוע שלפניו" : d < 0 ? `${shek(-d)} פחות מהשבוע שלפניו 👏` : `${shek(d)} יותר מהשבוע שלפניו`) : "";
  const top = w.top ? `הכי הרבה הלך על ${String(w.top).slice(0, 30)}.` : "";
  return { title: `השבוע שעבר: ${shek(w.total || 0)} 📊`, body: [cmp, top].filter(Boolean).join(" · ") + " לחיצה פותחת את הסיכום.", url: "./?week", tag: "ispend-week" };
}
const MSG = { title: "🧾 תזכורת", body: "יש הוצאות/הכנסות חדשות להיום? לחץ להוספה", url: "./?add" };

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const k = await keys();
  if (url.searchParams.has("vapid")) return json({ key: k.public_key });
  webpush.setVapidDetails("mailto:ispend@users.noreply.github.com", k.public_key, k.private_key);

  const send = async (s: { endpoint: string; sub: unknown }, msg: object) => {
    if (!PUSH_HOST.test(s.endpoint)) return false;
    try { await webpush.sendNotification(s.sub as any, JSON.stringify(msg)); return true; }
    catch (e) { const c = (e as { statusCode?: number }).statusCode; if (c === 404 || c === 410) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); return false; }
  };

  // a test from the settings: only to the person who asked
  if (url.searchParams.has("test")) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json({ error: "not signed in" }, 401);
    const { data: subs } = await sb.from("push_subs").select("endpoint, sub, week_stats").eq("user_id", u.user.id);
    const weekTest = url.searchParams.get("test") === "week";
    let sent = 0; for (const s of subs || []) if (await send(s, weekTest ? weeklyMsg(s as { week_stats?: unknown }, lastSunday(israelNow().day)) : { title: "iSpend 🔔", body: "ככה תיראה התזכורת של הערב.", url: "./?add", tag: "ispend-test" })) sent++;
    return json({ sent });
  }

  // the run every 15 minutes: only the database's own scheduler knows this secret
  if (!k.cron_secret || req.headers.get("x-ispend-cron") !== k.cron_secret) return json({ error: "forbidden" }, 403);
  // the run every 15 minutes: each phone at its own time, once a day (a time missed by more than two hours waits for tomorrow)
  const now = israelNow();
  const { data: subs } = await sb.from("push_subs").select("endpoint, sub, user_id, last_add, last_sent, remind_at, weekly, week_stats, week_sent");
  let sent = 0;
  // Sunday 08:30–10:30: last week in one notification
  const sunday = new Date(now.day + "T12:00:00Z").getUTCDay() === 0;
  if (sunday && now.mins >= 8 * 60 + 30 && now.mins <= 10 * 60 + 30) {
    const ws = lastSunday(now.day);
    for (const s of subs || []) {
      if (s.weekly === false || s.week_sent === now.day) continue;
      if (await send(s, weeklyMsg(s, ws))) { sent++; await sb.from("push_subs").update({ week_sent: now.day }).eq("endpoint", s.endpoint); }
    }
  }
  for (const s of subs || []) {
    const m = String(s.remind_at || "21:00").match(/^(\d{1,2}):(\d{2})/), at = m ? +m[1] * 60 + +m[2] : 21 * 60;
    if (now.mins < at || now.mins > at + 120) continue;
    if (s.last_sent === now.day || s.last_add === now.day) continue;
    // anything that reached the account today (Apple Pay included) counts as added
    const { count } = await sb.from("tx").select("id", { count: "exact", head: true }).eq("user_id", s.user_id).gte("created_at", now.sinceMidnight.toISOString());
    if (count) continue;
    if (await send(s, MSG)) { sent++; await sb.from("push_subs").update({ last_sent: now.day }).eq("endpoint", s.endpoint); }
  }
  return json({ sent });
});
