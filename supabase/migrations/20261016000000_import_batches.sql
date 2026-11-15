-- One record per import, so an import that stops partway can be retried and
-- reported accurately.
--
-- The browser picks the batch id when the person previews the files and sends
-- it with every attempt, so retrying the same import reuses the same record.
-- Saved rows carry import_batch_id: "how many did this import add" is always
-- a count of real rows, however many attempts it took. Saving is idempotent
-- anyway (fingerprints are unique per account, and a hand-added entry is only
-- replaced while it's still waiting), so a retry never duplicates anything.
--
-- status  saving   transactions are being saved (or an attempt stopped partway)
--         saved    every transaction is saved; sorting hasn't finished
--         sorted   finished
--
-- Only the person who ran an import can see its record: counts there include
-- their own private purchases.

create type public.import_status as enum ('saving', 'saved', 'sorted');

create table public.import_batches (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status public.import_status not null default 'saving',
  file_count integer not null default 0 check (file_count between 0 and 50),
  matched integer not null default 0 check (matched >= 0),
  duplicates integer not null default 0 check (duplicates >= 0),
  sort_problem text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);

create index import_batches_user_idx on public.import_batches (household_id, user_id, created_at desc);

create trigger import_batches_set_updated_at
  before update on public.import_batches
  for each row execute function public.set_updated_at();

alter table public.import_batches enable row level security;
revoke all on public.import_batches from anon;

create policy "import_batches: your own imports" on public.import_batches
  for all to authenticated
  using (user_id = (select auth.uid()) and public.is_household_member(household_id))
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));

alter table public.transactions
  add column import_batch_id uuid references public.import_batches (id) on delete set null;

create index transactions_import_batch_idx on public.transactions (import_batch_id) where import_batch_id is not null;
