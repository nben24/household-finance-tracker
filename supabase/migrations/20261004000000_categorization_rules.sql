-- Phase 3: categorization rules, and the bank's own category label on imports.

alter table public.transactions add column bank_category text;

create type public.rule_match_type as enum ('merchant', 'description', 'bank_category');
create type public.rule_source as enum ('default', 'learned', 'manual');

-- "When <match_type> is/contains <pattern>, use <subcategory>."
-- auto_apply = true  → categorize automatically, no review needed
-- auto_apply = false → only suggest; the transaction still waits for review
--                      (for merchants like Amazon whose purchases vary)
create table public.categorization_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  match_type public.rule_match_type not null,
  -- stored lowercased; merchant and bank_category match exactly, description
  -- matches whole words anywhere in the bank's description
  pattern text not null check (pattern = lower(pattern) and length(trim(pattern)) > 0),
  category_id uuid not null,
  subcategory_id uuid not null,
  auto_apply boolean not null default true,
  source public.rule_source not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, match_type, pattern),
  foreign key (category_id, household_id)
    references public.categories (id, household_id) on delete cascade,
  foreign key (subcategory_id, category_id)
    references public.categories (id, parent_id) on delete cascade
);

create trigger categorization_rules_set_updated_at
  before update on public.categorization_rules
  for each row execute function public.set_updated_at();

alter table public.categorization_rules enable row level security;
revoke all on public.categorization_rules from anon;

create policy "categorization_rules: members have full access" on public.categorization_rules
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- Paying each other back: money between the two of you that settles a shared
-- cost. It never counts toward household spending, but it moves spending from
-- the person who received it to the person who sent it.
alter type public.transaction_type add value 'reimbursement';

-- The other person in a payback (the sender, on the receiving side's row).
alter table public.transactions add column counterparty_id uuid;
alter table public.transactions add constraint transactions_counterparty_fkey
  foreign key (household_id, counterparty_id)
  references public.household_members (household_id, user_id);
