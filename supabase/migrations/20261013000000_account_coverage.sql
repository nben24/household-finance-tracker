-- Which dates each account's imported activity actually covers.
--
-- The earliest transaction in the household says nothing about whether every
-- account was imported for every month after it. Each import records the
-- period its file covers for that account: from the file's first date through
-- the date the person confirms the download runs to ("Activity downloaded
-- through November 13"). Months are only used as history (budget averages,
-- forecasts) when every account's coverage spans them.
--
-- source  import     recorded by an import, through date confirmed by a person
--         confirmed  typed in by a person without importing (e.g. "no activity")
--         estimated  filled in by this migration from transactions saved before
--                    coverage was tracked; shown as an estimate until confirmed

create type public.coverage_source as enum ('import', 'confirmed', 'estimated');

create table public.account_coverage (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null,
  covered_from date not null,
  covered_through date not null,
  source public.coverage_source not null default 'import',
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (covered_through >= covered_from),
  foreign key (account_id, household_id)
    references public.accounts (id, household_id) on delete cascade
);

create index account_coverage_account_idx on public.account_coverage (household_id, account_id);

alter table public.account_coverage enable row level security;
revoke all on public.account_coverage from anon;

create policy "account_coverage: members have full access" on public.account_coverage
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- Estimated coverage for accounts imported before this update: from each
-- account's first to last imported transaction. Private purchases are left
-- out so the estimate can never hint that one exists.
insert into public.account_coverage (household_id, account_id, covered_from, covered_through, source)
select household_id, account_id, min(transaction_date), max(transaction_date), 'estimated'
from public.transactions
where not is_manual and not is_private
group by household_id, account_id;
