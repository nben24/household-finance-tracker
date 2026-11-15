-- Retiring an account (closed, sold or paid off) used to hide it everywhere,
-- including from earlier months' net worth, which rewrote history. Now the
-- date it ended is recorded: it counts in net worth on dates before closed_on
-- and not from that date on. is_active still decides whether it's listed
-- among current accounts.
--
-- Accounts retired before this update have no closed_on; the app counts them
-- through their last recorded balance until someone sets the date.

alter table public.accounts add column closed_on date;

alter table public.accounts add constraint accounts_closed_when_retired
  check (closed_on is null or not is_active);
