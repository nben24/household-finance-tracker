-- Private transactions: a person can keep one of their own purchases from the
-- other household member (e.g. a present), optionally until a date.
--
-- This is enforced here, not just in the app: the other member's queries
-- simply don't return the row, so every total they see is computed without it.
--
-- is_private      only the transaction's person can see it
-- private_until   from this date on it is visible to everyone again (null = until changed)

alter table public.transactions add column is_private boolean not null default false;
alter table public.transactions add column private_until date;
alter table public.transactions add constraint transactions_private_has_person
  check (not is_private or person_id is not null);

-- Visible to a member unless it's someone else's private transaction that hasn't been revealed yet.
create function public.can_see_transaction(
  target_household_id uuid,
  target_person_id uuid,
  target_is_private boolean,
  target_private_until date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_household_member(target_household_id)
    and (
      not target_is_private
      or target_person_id = (select auth.uid())
      or (target_private_until is not null and target_private_until <= current_date)
    );
$$;

revoke execute on function public.can_see_transaction(uuid, uuid, boolean, date) from anon, public;
grant execute on function public.can_see_transaction(uuid, uuid, boolean, date) to authenticated;

drop policy "transactions: members have full access" on public.transactions;

create policy "transactions: members read what they may see" on public.transactions
  for select to authenticated
  using (public.can_see_transaction(household_id, person_id, is_private, private_until));

-- Only the person a transaction belongs to can make it private.
create policy "transactions: members add" on public.transactions
  for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and (not is_private or person_id = (select auth.uid()))
  );

create policy "transactions: members change what they may see" on public.transactions
  for update to authenticated
  using (public.can_see_transaction(household_id, person_id, is_private, private_until))
  with check (
    public.is_household_member(household_id)
    and (not is_private or person_id = (select auth.uid()))
  );

create policy "transactions: members delete what they may see" on public.transactions
  for delete to authenticated
  using (public.can_see_transaction(household_id, person_id, is_private, private_until));
