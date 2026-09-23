-- The app reads these tables server-side as the postgres role, which bypasses RLS.
-- Enabling RLS with no policies blocks access through the Data API
-- (anon/authenticated roles), now that a publishable key ships to the browser.
do $$
declare
  t text;
begin
  foreach t in array array['users', 'invoices', 'customers', 'revenue'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end
$$;
