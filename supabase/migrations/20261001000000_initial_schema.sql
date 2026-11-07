-- Phase 1 schema: households, members, accounts, categories, transactions.
-- Every household-scoped table carries household_id and is protected by RLS.
-- Composite foreign keys make it impossible to point a row at another
-- household's account, category or member, even with a forged id.

create type public.household_role as enum ('owner', 'member');

create type public.account_type as enum (
  'checking', 'savings', 'credit_card', 'brokerage', 'retirement',
  'hsa', 'crypto', 'mortgage', 'other'
);

create type public.transaction_type as enum (
  'expense', 'income', 'transfer', 'credit_card_payment', 'refund',
  'adjustment', 'investment_contribution', 'investment_withdrawal'
);

create type public.expense_type as enum ('fixed', 'variable', 'discretionary', 'irregular');

create type public.review_status as enum ('auto_categorized', 'needs_review', 'reviewed');

create type public.confidence_level as enum ('high', 'medium', 'low');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per signed-in person. Mirrors auth.users (the spec's "users" table).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '',
  created_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.household_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_id_idx on public.household_members (user_id);

-- Financial accounts. Deliberately has no column for full account numbers,
-- routing numbers, card numbers or credentials.
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_user_id uuid, -- null = joint account
  institution text not null,
  account_name text not null,
  account_type public.account_type not null,
  last_four text check (last_four ~ '^[0-9]{4}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (household_id, owner_user_id)
    references public.household_members (household_id, user_id)
);

create index accounts_household_id_idx on public.accounts (household_id);

-- Two-level hierarchy: parent_id is null for a category, set for a subcategory.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  parent_id uuid,
  name text not null,
  default_expense_type public.expense_type,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  unique (id, parent_id),
  foreign key (parent_id, household_id)
    references public.categories (id, household_id) on delete cascade
);

create unique index categories_unique_name_idx on public.categories (
  household_id,
  coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
  lower(name)
);

create function public.enforce_category_depth()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and exists (
    select 1 from public.categories c
    where c.id = new.parent_id and c.parent_id is not null
  ) then
    raise exception 'Subcategories cannot have their own subcategories';
  end if;
  return new;
end;
$$;

create trigger categories_enforce_depth
  before insert or update of parent_id on public.categories
  for each row execute function public.enforce_category_depth();

-- Sign convention: negative = money leaving the account, positive = money in.
-- transaction_type (not the sign) decides whether a row counts as spending.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  account_id uuid not null,
  person_id uuid, -- who it belongs to; null = shared household
  transaction_date date not null,
  posting_date date,
  original_description text not null,
  normalized_merchant text not null,
  amount numeric(12, 2) not null,
  transaction_type public.transaction_type not null default 'expense',
  category_id uuid,
  subcategory_id uuid,
  expense_type public.expense_type,
  is_recurring boolean not null default false,
  is_transfer boolean generated always as (
    transaction_type in ('transfer', 'credit_card_payment')
  ) stored,
  review_status public.review_status not null default 'needs_review',
  categorization_confidence public.confidence_level,
  categorization_reason text,
  notes text,
  source_file text,
  source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (subcategory_id is null or category_id is not null),
  foreign key (account_id, household_id)
    references public.accounts (id, household_id),
  foreign key (household_id, person_id)
    references public.household_members (household_id, user_id),
  foreign key (category_id, household_id)
    references public.categories (id, household_id),
  -- a subcategory must belong to the row's category
  foreign key (subcategory_id, category_id)
    references public.categories (id, parent_id)
);

create index transactions_household_date_idx
  on public.transactions (household_id, transaction_date desc);
create index transactions_household_review_idx
  on public.transactions (household_id, review_status);
create index transactions_account_idx on public.transactions (account_id);
create index transactions_source_hash_idx
  on public.transactions (household_id, source_hash)
  where source_hash is not null;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profile creation on sign-up
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

-- security definer so policies on household_members don't recurse into themselves
create function public.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = target_household_id
      and m.user_id = (select auth.uid())
  );
$$;

create function public.shares_household_with(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members mine
    join public.household_members theirs using (household_id)
    where mine.user_id = (select auth.uid())
      and theirs.user_id = other_user_id
  );
$$;

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;

-- Signed-out visitors get nothing, even before RLS is consulted.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.shares_household_with(uuid) to authenticated;

-- Households and memberships are read-only for signed-in users; they are
-- created by the setup script using the service role.
revoke insert, update, delete on public.households from authenticated;
revoke insert, update, delete on public.household_members from authenticated;
revoke insert, update, delete on public.profiles from authenticated;
grant update (name) on public.profiles to authenticated;

create policy "profiles: read self and housemates" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_household_with(id));

create policy "profiles: update own name" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "households: members can read" on public.households
  for select to authenticated
  using (public.is_household_member(id));

create policy "household_members: members can read" on public.household_members
  for select to authenticated
  using (public.is_household_member(household_id));

create policy "accounts: members have full access" on public.accounts
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "categories: members have full access" on public.categories
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "transactions: members have full access" on public.transactions
  for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
