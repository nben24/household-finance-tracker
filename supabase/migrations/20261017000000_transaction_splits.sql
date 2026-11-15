-- Split purchases: one bank transaction divided between categories (a Target
-- run that's part groceries, part household supplies).
--
-- The imported transaction stays exactly as the bank reported it: it's still
-- what's matched against later imports (its fingerprint never changes) and
-- what reconciles with the statement. Its allocations say how its amount is
-- divided; totals, budgets, reports and forecasts count the allocations
-- instead of the transaction's own category, so nothing is counted twice.
--
-- Rules:
--   - allocations add up to the transaction's amount exactly, to the cent,
--     each with the same sign (enforced by save_transaction_splits)
--   - only spending and refunds can be split
--   - every allocation belongs to the transaction's person (who paid); moving
--     costs between people is what paybacks are for
--   - allocations are visible exactly when their transaction is (Row Level
--     Security reads through to the transaction), so a private purchase's
--     split is private too
--   - if the transaction's amount or kind changes, its split no longer fits:
--     it's removed and the transaction goes back to review
--
-- Refunds can point at the purchase they refund (refund_of), and a refund's
-- allocations can point at the allocation they reverse (refund_of_split_id).

alter table public.transactions add constraint transactions_id_household_key unique (id, household_id);

alter table public.transactions add column refund_of uuid;
alter table public.transactions add constraint transactions_refund_of_fkey
  foreign key (refund_of, household_id) references public.transactions (id, household_id) on delete set null (refund_of);
alter table public.transactions add constraint transactions_refund_of_is_refund
  check (refund_of is null or transaction_type = 'refund');

create table public.transaction_splits (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  transaction_id uuid not null,
  position integer not null default 0,
  category_id uuid not null,
  subcategory_id uuid,
  amount numeric(12, 2) not null check (amount <> 0),
  note text check (note is null or length(note) <= 200),
  refund_of_split_id uuid references public.transaction_splits (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (transaction_id, household_id)
    references public.transactions (id, household_id) on delete cascade,
  foreign key (category_id, household_id)
    references public.categories (id, household_id),
  foreign key (subcategory_id, category_id)
    references public.categories (id, parent_id)
);

create index transaction_splits_transaction_idx on public.transaction_splits (transaction_id);

alter table public.transaction_splits enable row level security;
revoke all on public.transaction_splits from anon;

-- Visible, and changeable, exactly when the transaction is.
create policy "transaction_splits: follow their transaction" on public.transaction_splits
  for all to authenticated
  using (exists (select 1 from public.transactions t where t.id = transaction_splits.transaction_id))
  with check (
    public.is_household_member(household_id)
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_splits.transaction_id and t.household_id = transaction_splits.household_id
    )
  );

-- Replaces a transaction's split in one step. `splits` is a JSON array of
-- {category_id, subcategory_id, amount, note, refund_of_split_id}; an empty
-- array removes the split. Errors (P0001): split_not_found, split_kind,
-- split_count, split_sign, split_total.
create function public.save_transaction_splits(target_transaction_id uuid, splits jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent public.transactions;
  item jsonb;
  total numeric(14, 2) := 0;
  n integer;
  largest jsonb;
  index integer := 0;
begin
  select * into parent from public.transactions where id = target_transaction_id for update;
  if not found then
    raise exception 'split_not_found';
  end if;

  delete from public.transaction_splits where transaction_id = parent.id;
  n := coalesce(jsonb_array_length(splits), 0);
  if n = 0 then
    return;
  end if;

  if parent.transaction_type not in ('expense', 'refund') then
    raise exception 'split_kind';
  end if;
  if n < 2 or n > 20 then
    raise exception 'split_count';
  end if;

  for item in select * from jsonb_array_elements(splits) loop
    if sign((item ->> 'amount')::numeric) <> sign(parent.amount) then
      raise exception 'split_sign';
    end if;
    total := total + (item ->> 'amount')::numeric(12, 2);
    if largest is null or abs((item ->> 'amount')::numeric) > abs((largest ->> 'amount')::numeric) then
      largest := item;
    end if;
  end loop;
  if total <> parent.amount then
    raise exception 'split_total';
  end if;

  for item in select * from jsonb_array_elements(splits) loop
    insert into public.transaction_splits
      (household_id, transaction_id, position, category_id, subcategory_id, amount, note, refund_of_split_id)
    values (
      parent.household_id,
      parent.id,
      index,
      (item ->> 'category_id')::uuid,
      nullif(item ->> 'subcategory_id', '')::uuid,
      (item ->> 'amount')::numeric(12, 2),
      nullif(left(item ->> 'note', 200), ''),
      nullif(item ->> 'refund_of_split_id', '')::uuid
    );
    index := index + 1;
  end loop;

  -- The transaction itself shows its largest part, so lists and filters still
  -- make sense; totals use the allocations.
  update public.transactions
     set category_id = (largest ->> 'category_id')::uuid,
         subcategory_id = nullif(largest ->> 'subcategory_id', '')::uuid,
         expense_type = null,
         review_status = 'reviewed',
         categorization_confidence = 'high',
         categorization_reason = format('Split between %s categories', n)
   where id = parent.id;
end;
$$;

revoke execute on function public.save_transaction_splits(uuid, jsonb) from anon, public;
grant execute on function public.save_transaction_splits(uuid, jsonb) to authenticated;

-- A split only fits the amount and kind it was made for.
create function public.clear_stale_splits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.amount <> old.amount or new.transaction_type not in ('expense', 'refund'))
     and exists (select 1 from public.transaction_splits s where s.transaction_id = new.id) then
    delete from public.transaction_splits where transaction_id = new.id;
    new.review_status := 'needs_review';
    new.categorization_reason := 'Its split was removed because the amount or kind changed';
  end if;
  return new;
end;
$$;

create trigger transactions_clear_stale_splits
  before update of amount, transaction_type on public.transactions
  for each row execute function public.clear_stale_splits();
