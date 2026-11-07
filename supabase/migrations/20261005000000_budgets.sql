-- Phase 5: monthly budgets, per view.
--
-- scope 'everyone' = whole household, 'person' = one member's own spending,
-- 'shared' = the joint account. A line covers a category (or one subcategory)
-- from starts_month until ends_month (null = still in effect). Changing an
-- amount ends the old line and starts a new one, so past months keep the
-- budget they actually had.

create type public.budget_scope as enum ('everyone', 'person', 'shared');
create type public.budget_kind as enum ('fixed', 'variable', 'allowance', 'sinking_fund');

create table public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  scope public.budget_scope not null,
  person_id uuid,
  category_id uuid not null,
  subcategory_id uuid,
  kind public.budget_kind not null default 'variable',
  amount numeric(12, 2) not null check (amount >= 0),
  starts_month date not null check (extract(day from starts_month) = 1),
  ends_month date check (ends_month is null or (extract(day from ends_month) = 1 and ends_month >= starts_month)),
  created_at timestamptz not null default now(),
  check ((scope = 'person') = (person_id is not null)),
  foreign key (household_id, person_id)
    references public.household_members (household_id, user_id) on delete cascade,
  foreign key (category_id, household_id)
    references public.categories (id, household_id) on delete cascade,
  foreign key (subcategory_id, category_id)
    references public.categories (id, parent_id) on delete cascade
);

create index budget_lines_household_idx on public.budget_lines (household_id, scope);

alter table public.budget_lines enable row level security;
revoke all on public.budget_lines from anon;

create policy "budget_lines: members have full access" on public.budget_lines
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
