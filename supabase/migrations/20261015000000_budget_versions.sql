-- Budget changes in one step.
--
-- Changing a budget from a month on ends the old line and starts a new one.
-- Done as two separate requests, a failure in between could leave the
-- category with no budget at all. These functions do each change in a single
-- transaction: it all happens or none of it does.
--
-- They run as the signed-in person (security invoker), so Row Level Security
-- still decides what they can touch. A per-household lock makes two people's
-- simultaneous changes take turns, and each change re-checks the line it is
-- based on, so a stale screen can't overwrite a newer change.
--
-- Errors raised (SQLSTATE P0001 with these messages):
--   budget_not_found   the line doesn't exist or isn't visible
--   budget_stale       the line was changed or ended since the screen loaded
--   budget_conflict    another active line already counts this spending

create function public.budget_conflict_exists(
  target_household_id uuid,
  new_scope public.budget_scope,
  new_person_id uuid,
  new_category_id uuid,
  new_subcategory_id uuid,
  from_month date,
  ignore_line_id uuid default null,
  -- "split" mode: a person's view includes their share of shared spending
  split_mode boolean default false
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.budget_lines l
    where l.household_id = target_household_id
      and (ignore_line_id is null or l.id <> ignore_line_id)
      and (l.ends_month is null or l.ends_month >= from_month)
      and l.category_id = new_category_id
      and (l.subcategory_id is null or new_subcategory_id is null or l.subcategory_id = new_subcategory_id)
      and (
        (l.scope = new_scope and l.person_id is not distinct from new_person_id)
        or l.scope = 'everyone'
        or new_scope = 'everyone'
        or (split_mode and l.scope <> new_scope and l.scope <> 'everyone' and new_scope <> 'everyone')
      )
  );
$$;

create function public.create_budget_line(
  target_household_id uuid,
  new_scope public.budget_scope,
  new_person_id uuid,
  new_category_id uuid,
  new_subcategory_id uuid,
  new_kind public.budget_kind,
  new_amount numeric,
  from_month date,
  split_mode boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not public.is_household_member(target_household_id) then
    raise exception 'budget_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtext('budget:' || target_household_id::text));
  if public.budget_conflict_exists(
    target_household_id, new_scope, new_person_id, new_category_id, new_subcategory_id, from_month, null, split_mode
  ) then
    raise exception 'budget_conflict';
  end if;
  insert into public.budget_lines
    (household_id, scope, person_id, category_id, subcategory_id, kind, amount, starts_month, ends_month)
  values
    (target_household_id, new_scope, new_person_id, new_category_id, new_subcategory_id, new_kind, new_amount, from_month, null)
  returning id into new_id;
  return new_id;
end;
$$;

-- Changes a line's amount and kind from a month on. Earlier months keep the
-- old version. Returns the id of the line in effect from that month.
create function public.change_budget_line(
  target_line_id uuid,
  from_month date,
  new_amount numeric,
  new_kind public.budget_kind
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  line public.budget_lines;
  new_id uuid;
begin
  select * into line from public.budget_lines where id = target_line_id;
  if not found then
    raise exception 'budget_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtext('budget:' || line.household_id::text));
  -- Read again under the lock: someone may have changed it while we waited.
  select * into line from public.budget_lines where id = target_line_id for update;
  if not found then
    raise exception 'budget_not_found';
  end if;
  if line.starts_month > from_month or (line.ends_month is not null and line.ends_month < from_month) then
    raise exception 'budget_stale';
  end if;

  if line.starts_month = from_month then
    update public.budget_lines set amount = new_amount, kind = new_kind where id = line.id;
    return line.id;
  end if;

  update public.budget_lines
    set ends_month = (from_month - interval '1 month')::date
    where id = line.id;
  insert into public.budget_lines
    (household_id, scope, person_id, category_id, subcategory_id, kind, amount, starts_month, ends_month)
  values
    (line.household_id, line.scope, line.person_id, line.category_id, line.subcategory_id,
     new_kind, new_amount, from_month, line.ends_month)
  returning id into new_id;
  return new_id;
end;
$$;

-- Stops a line from a month on (deleting it if it started that month).
create function public.end_budget_line(target_line_id uuid, from_month date)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  line public.budget_lines;
begin
  select * into line from public.budget_lines where id = target_line_id;
  if not found then
    raise exception 'budget_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtext('budget:' || line.household_id::text));
  select * into line from public.budget_lines where id = target_line_id for update;
  if not found then
    raise exception 'budget_not_found';
  end if;
  if line.starts_month > from_month or (line.ends_month is not null and line.ends_month < from_month) then
    raise exception 'budget_stale';
  end if;
  if line.starts_month = from_month then
    delete from public.budget_lines where id = line.id;
  else
    update public.budget_lines set ends_month = (from_month - interval '1 month')::date where id = line.id;
  end if;
end;
$$;

revoke execute on function public.budget_conflict_exists(uuid, public.budget_scope, uuid, uuid, uuid, date, uuid, boolean) from anon, public;
revoke execute on function public.create_budget_line(uuid, public.budget_scope, uuid, uuid, uuid, public.budget_kind, numeric, date, boolean) from anon, public;
revoke execute on function public.change_budget_line(uuid, date, numeric, public.budget_kind) from anon, public;
revoke execute on function public.end_budget_line(uuid, date) from anon, public;
grant execute on function public.budget_conflict_exists(uuid, public.budget_scope, uuid, uuid, uuid, date, uuid, boolean) to authenticated;
grant execute on function public.create_budget_line(uuid, public.budget_scope, uuid, uuid, uuid, public.budget_kind, numeric, date, boolean) to authenticated;
grant execute on function public.change_budget_line(uuid, date, numeric, public.budget_kind) to authenticated;
grant execute on function public.end_budget_line(uuid, date) to authenticated;
