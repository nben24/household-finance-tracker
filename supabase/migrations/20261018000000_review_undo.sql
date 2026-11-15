-- Undo for review decisions.
--
-- One review decision can change the transaction, create or change a sorting
-- rule, and sort other waiting transactions with it. Each decision is recorded
-- as an operation: what every affected transaction and rule looked like
-- before, and when each was last changed right after. Undo puts everything
-- back in one step, but only if nothing has changed since; if the other
-- person (or anyone) edited one of them in the meantime, undo refuses rather
-- than overwrite their change.
--
-- Only the person who made a decision can see or undo it: its record may hold
-- details of their own private purchases.
--
-- transactions  [{id, before: {transaction_type, counterparty_id, category_id,
--                 subcategory_id, expense_type, review_status,
--                 categorization_confidence, categorization_reason, notes},
--                 splits: [...] | null, after: <updated_at>}]
-- rules         [{match_type, pattern, before: {category_id, subcategory_id,
--                 auto_apply, source} | null, after: <updated_at>}]
--               (before null = the decision created the rule)

create table public.review_operations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  summary text not null check (length(summary) <= 300),
  transactions jsonb not null default '[]',
  rules jsonb not null default '[]',
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);

create index review_operations_user_idx on public.review_operations (household_id, user_id, created_at desc);

alter table public.review_operations enable row level security;
revoke all on public.review_operations from anon;

create policy "review_operations: your own decisions" on public.review_operations
  for all to authenticated
  using (user_id = (select auth.uid()) and public.is_household_member(household_id))
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));

-- Errors (P0001): undo_gone (not found, not yours, or already undone),
-- undo_conflict (something changed since; nothing was undone).
create function public.undo_review_operation(target_operation_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  op public.review_operations;
  item jsonb;
  b jsonb;
  current_row public.transactions;
  current_rule public.categorization_rules;
  conflicts integer := 0;
begin
  select * into op from public.review_operations
   where id = target_operation_id and user_id = (select auth.uid()) and undone_at is null
   for update;
  if not found then
    raise exception 'undo_gone';
  end if;

  -- Check everything first; change nothing unless all of it is safe.
  for item in select * from jsonb_array_elements(op.transactions) loop
    select * into current_row from public.transactions where id = (item ->> 'id')::uuid for update;
    if not found or current_row.updated_at <> (item ->> 'after')::timestamptz then
      conflicts := conflicts + 1;
    end if;
  end loop;
  for item in select * from jsonb_array_elements(op.rules) loop
    select * into current_rule from public.categorization_rules
     where household_id = op.household_id
       and match_type = (item ->> 'match_type')::public.rule_match_type
       and pattern = item ->> 'pattern'
     for update;
    if not found or current_rule.updated_at <> (item ->> 'after')::timestamptz then
      conflicts := conflicts + 1;
    end if;
  end loop;
  if conflicts > 0 then
    raise exception 'undo_conflict';
  end if;

  for item in select * from jsonb_array_elements(op.transactions) loop
    b := item -> 'before';
    update public.transactions set
      transaction_type = (b ->> 'transaction_type')::public.transaction_type,
      counterparty_id = nullif(b ->> 'counterparty_id', '')::uuid,
      category_id = nullif(b ->> 'category_id', '')::uuid,
      subcategory_id = nullif(b ->> 'subcategory_id', '')::uuid,
      expense_type = nullif(b ->> 'expense_type', '')::public.expense_type,
      review_status = (b ->> 'review_status')::public.review_status,
      categorization_confidence = nullif(b ->> 'categorization_confidence', '')::public.confidence_level,
      categorization_reason = b ->> 'categorization_reason',
      notes = b ->> 'notes'
    where id = (item ->> 'id')::uuid;
    -- A split the decision removed comes back.
    if jsonb_typeof(item -> 'splits') = 'array' and jsonb_array_length(item -> 'splits') > 0 then
      delete from public.transaction_splits where transaction_id = (item ->> 'id')::uuid;
      insert into public.transaction_splits
        (household_id, transaction_id, position, category_id, subcategory_id, amount, note, refund_of_split_id)
      select op.household_id, (item ->> 'id')::uuid, (s ->> 'position')::integer, (s ->> 'category_id')::uuid,
             nullif(s ->> 'subcategory_id', '')::uuid, (s ->> 'amount')::numeric, s ->> 'note',
             nullif(s ->> 'refund_of_split_id', '')::uuid
        from jsonb_array_elements(item -> 'splits') as s;
    end if;
  end loop;

  for item in select * from jsonb_array_elements(op.rules) loop
    b := item -> 'before';
    if b is null or jsonb_typeof(b) = 'null' then
      delete from public.categorization_rules
       where household_id = op.household_id
         and match_type = (item ->> 'match_type')::public.rule_match_type
         and pattern = item ->> 'pattern';
    else
      update public.categorization_rules set
        category_id = (b ->> 'category_id')::uuid,
        subcategory_id = (b ->> 'subcategory_id')::uuid,
        auto_apply = (b ->> 'auto_apply')::boolean,
        source = (b ->> 'source')::public.rule_source
      where household_id = op.household_id
        and match_type = (item ->> 'match_type')::public.rule_match_type
        and pattern = item ->> 'pattern';
    end if;
  end loop;

  update public.review_operations set undone_at = now() where id = op.id;
end;
$$;

revoke execute on function public.undo_review_operation(uuid) from anon, public;
grant execute on function public.undo_review_operation(uuid) to authenticated;
