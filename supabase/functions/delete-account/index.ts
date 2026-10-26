// iSpend: deletes the signed-in person's account (Supabase Edge Function "delete-account").
// Removing the sign-in removes everything tied to it: profile, transactions, reminder phones, AI usage
// (every table points to the account with "on delete cascade"). A linked Google Sheet is not touched.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user) return json({ error: "not signed in" }, 401);
  let body: { confirm?: string } = {};
  try { body = await req.json(); } catch (_) { /* empty */ }
  if (body.confirm !== "DELETE") return json({ error: "not confirmed" }, 400);
  const id = u.user.id;
  // the rows first (in case a table was made without cascade), then the sign-in itself
  for (const t of ["push_subs", "ai_usage", "tx"]) await sb.from(t).delete().eq("user_id", id);
  await sb.from("profiles").delete().eq("id", id);
  const { error } = await sb.auth.admin.deleteUser(id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
});
