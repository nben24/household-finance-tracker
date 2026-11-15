-- One calendar for the whole household, shared by the app and the database.
--
-- A private purchase's reveal date means "visible from midnight on that date,
-- household time". Before this, the database compared it with current_date
-- (the database server's date, usually UTC) while the app used the household's
-- own time zone, so for a few hours around midnight the two disagreed.
--
-- households.time_zone  IANA name (e.g. America/New_York). The app reads it
--                       from here; HOUSEHOLD_TIME_ZONE is only the fallback
--                       for a database that hasn't had this update yet.

create function public.is_valid_time_zone(zone text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = zone);
$$;

alter table public.households
  add column time_zone text not null default 'America/New_York';

create function public.check_household_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_valid_time_zone(new.time_zone) then
    raise exception 'Unknown time zone: %', new.time_zone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger households_check_time_zone
  before insert or update of time_zone on public.households
  for each row execute function public.check_household_time_zone();

-- Members may change the household's time zone (like the review start date).
grant update (time_zone) on public.households to authenticated;

-- The household's calendar date at a moment (now, by default).
create function public.household_today(target_household_id uuid, at_time timestamptz default now())
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (at_time at time zone coalesce(
    (select h.time_zone from public.households h where h.id = target_household_id),
    'UTC'
  ))::date;
$$;

revoke execute on function public.household_today(uuid, timestamptz) from anon, public;
grant execute on function public.household_today(uuid, timestamptz) to authenticated;
revoke execute on function public.is_valid_time_zone(text) from anon, public;
grant execute on function public.is_valid_time_zone(text) to authenticated;

-- Same rule as before, with the household's own date instead of the server's.
create or replace function public.can_see_transaction(
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
      or (
        target_private_until is not null
        and target_private_until <= public.household_today(target_household_id)
      )
    );
$$;
