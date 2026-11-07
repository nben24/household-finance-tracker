-- Phase 8: expected income, entered by people (spec §31). Forecasts use these;
-- anyone without an entry falls back to paychecks detected from history.
--
-- frequency    weekly | biweekly (every 7 or 14 days from anchor_date)
--              semimonthly (the day of anchor_date and second_day each month)
--              monthly (the day of anchor_date each month)
-- anchor_date  any real pay date on the schedule

create type public.income_frequency as enum ('weekly', 'biweekly', 'semimonthly', 'monthly');

create table public.income_sources (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  person_id uuid, -- null = shared income (e.g. interest on the joint account)
  name text not null check (length(trim(name)) between 1 and 60),
  amount numeric(12, 2) not null check (amount > 0),
  frequency public.income_frequency not null,
  anchor_date date not null,
  second_day integer check (second_day between 1 and 31),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((frequency = 'semimonthly') = (second_day is not null)),
  foreign key (household_id, person_id)
    references public.household_members (household_id, user_id) on delete cascade
);

alter table public.income_sources enable row level security;
revoke all on public.income_sources from anon;

create policy "income_sources: members have full access" on public.income_sources
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
