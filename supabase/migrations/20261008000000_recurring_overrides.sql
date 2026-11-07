-- Phase 6: recurring charges are detected from history on the fly; this table
-- only remembers what people told the app about them.
--
-- recurring_key  merchant (lowercased) | charge or income | owner, as computed
--                by src/lib/finance/recurring.ts
-- status         not_recurring = a false detection, hide it
--                stopped       = it was real but has ended (cancelled)

create type public.recurring_status as enum ('not_recurring', 'stopped');

create table public.recurring_overrides (
  household_id uuid not null references public.households (id) on delete cascade,
  recurring_key text not null check (length(recurring_key) between 1 and 300),
  status public.recurring_status not null,
  created_at timestamptz not null default now(),
  primary key (household_id, recurring_key)
);

alter table public.recurring_overrides enable row level security;
revoke all on public.recurring_overrides from anon;

create policy "recurring_overrides: members have full access" on public.recurring_overrides
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
