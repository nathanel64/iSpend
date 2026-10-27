-- iSpend
-- run by GitHub Actions on push
-- until now a card or bank charge dated today counted as "you already added today" and silenced the reminder.
-- the site now counts only what the person added; today's mark made the old way is cleared.
update public.push_subs set last_add = null where last_add = (now() at time zone 'Asia/Jerusalem')::date and last_sent is null;
