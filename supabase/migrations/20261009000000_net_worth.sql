-- Phase 7: net worth.
--
-- Accounts double as net-worth items. A few kinds exist only for net worth:
-- a home, a vehicle, and loans. Balances are dated snapshots; the latest one on
-- or before a date is that account's balance then.
--
-- Balances are stored as plain amounts: what an asset is worth, or what is
-- owed on a debt (credit cards, mortgage, loans). Whether a kind of account is
-- an asset or a debt is decided by its type (src/lib/finance/net-worth.ts).

alter type public.account_type add value 'property';
alter type public.account_type add value 'vehicle';
alter type public.account_type add value 'loan';

create type public.balance_source as enum ('manual', 'import');

create table public.account_balances (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null,
  as_of date not null,
  balance numeric(14, 2) not null,
  source public.balance_source not null default 'manual',
  created_at timestamptz not null default now(),
  -- one balance per account per day; a balance typed in replaces an imported one
  unique (account_id, as_of),
  foreign key (account_id, household_id)
    references public.accounts (id, household_id) on delete cascade
);

create index account_balances_household_idx on public.account_balances (household_id, as_of);

alter table public.account_balances enable row level security;
revoke all on public.account_balances from anon;

create policy "account_balances: members have full access" on public.account_balances
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
