-- Month-end review: "we've gone through October". Closing a month records a
-- small snapshot of its totals so later changes (a refund, a correction) can be
-- pointed out: "Spending has changed by +$42 since you closed October." It
-- never locks anything; transactions in a closed month can still change.
--
-- The snapshot only counts what both of you can see (private purchases that
-- haven't been revealed are left out), so it can never give one away. Closing
-- again replaces the snapshot.

create table public.month_closings (
  household_id uuid not null references public.households (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  closed_by uuid references public.profiles (id) on delete set null,
  closed_at timestamptz not null default now(),
  spending_cents bigint not null,
  income_cents bigint not null,
  transaction_count integer not null check (transaction_count >= 0),
  primary key (household_id, month)
);

alter table public.month_closings enable row level security;
revoke all on public.month_closings from anon;

create policy "month_closings: members have full access" on public.month_closings
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
