-- Catch-up for history, and rules suggested by AI.

-- Transactions before this date are history: suggestions are accepted
-- automatically and anything left is handled on the Catch-up page instead of
-- Sunday Review. Null = everything goes through Sunday Review.
alter table public.households add column review_starts_on date;

-- Members may change this one setting (households are otherwise read-only).
grant update (review_starts_on) on public.households to authenticated;

create policy "households: members can update settings" on public.households
  for update to authenticated
  using (public.is_household_member(id))
  with check (public.is_household_member(id));

-- Rules created from an AI suggestion are labelled as such.
alter type public.rule_source add value 'ai';
