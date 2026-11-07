-- Transactions added by hand (e.g. a Saturday charge that hasn't posted by
-- the Sunday meeting, or cash).
--
-- is_manual      typed in by a person rather than imported
-- awaiting_post  expected to show up in a later bank download; when it does,
--                the import updates this row with the bank's details instead
--                of adding a second copy

alter table public.transactions add column is_manual boolean not null default false;
alter table public.transactions add column awaiting_post boolean not null default false;
alter table public.transactions add constraint transactions_awaiting_post_is_manual
  check (not awaiting_post or is_manual);

create index transactions_awaiting_post_idx
  on public.transactions (household_id, account_id)
  where awaiting_post;
