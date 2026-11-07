# Household Finance Tracker

A personal finance app for a two-person household, built to replace a weekly
spreadsheet. Bank and card exports are imported, sorted into categories that
learn from your choices, and reviewed together once a week. Every number can be
seen for the whole household, for each person, or for the shared (joint) account.

**Try it in a minute** — no database or login needed:

```bash
npm install
npm run demo       # http://localhost:3100 · a made-up household, John & Jane Doe, with a year of data
```

## What it does

- **Import from banks** (CSV or Excel): Chase, Bank of America, Truist and
  American Express layouts, read in the browser. Account-number columns are
  dropped before anything leaves the device, and re-importing the same file
  never creates duplicates.
- **Knows what isn't spending**: card payments, transfers between accounts,
  savings moves and investing are recognized and kept out of spending totals.
  Zelle payments between the two people, and money into and out of the joint
  account, are matched from both sides.
- **Sunday Review**: anything the app wasn't sure about waits for a quick
  weekly decision; each decision can become a rule for next time. Optional AI
  (Claude) suggests categories for unfamiliar merchants, sending only merchant
  names.
- **Four views of every page**: Everyone, each person, and Shared. Paying each
  other back moves spending between people without changing the household total.
- **Dashboard, budgets and reports**: income, spending, saved & invested, and
  what's left over, by week or month; budgets per category and per person,
  including sinking funds; month-by-category reports with CSV export.
- **Recurring bills and subscriptions** detected from history, with price changes.
- **Forecast** for this month and next from explainable baselines (no black box):
  bills still to come, expected paychecks, usual everyday spending, and a range.
- **Net worth** from dated account balances, including balances read from imports.
- **Private purchases** (say, a gift for the other person) stay hidden from the
  other person until a reveal date, while still counting in the totals.

## Engineering highlights

- **Next.js 16 (App Router), TypeScript, Tailwind CSS**; server-rendered pages
  and server actions, no separate backend.
- **Supabase (Postgres + Auth)** with **Row Level Security** on every table and
  composite foreign keys, so one household can never read or point at another's data.
- **312 tests (Vitest)**, including database tests that run the real migrations
  in PGlite (in-process Postgres) and check the security policies.
- **Deterministic synthetic data generator** that powers the demo, the seed
  script and the tests.
- All money maths in pure, tested functions; amounts handled in cents.

## Architecture

| Piece | Choice |
| --- | --- |
| Web app | Next.js 16 (App Router), TypeScript, Tailwind CSS |
| Database + login | Supabase (Postgres, Auth, Row Level Security) |
| Hosting | Vercel |
| Tests | Vitest; database tests run the real migrations in PGlite (in-process Postgres) |

There is no separate backend. Pages are server-rendered and read from
Supabase as the signed-in person, so every query is filtered by Row Level
Security in the database.

```
src/
  app/
    (app)/            signed-in pages: dashboard, transactions, review, settings, …
    login/, auth/     sign-in, email-link landing, password reset, server actions
  proxy.ts            refreshes the session; redirects signed-out visitors to /login
  components/         navigation, cards, transaction list, auth forms
  lib/
    data/             one DataSource interface, two implementations: supabase.ts and demo.ts
    db/types.ts       row types matching the migration
    finance/          spending/income maths (pure, tested)
    seed/generate.ts  deterministic synthetic household
    import/           CSV reading, bank adapters, merchant names, type detection, duplicate fingerprints
    categories/       default category tree
    dates.ts, money.ts
supabase/migrations/  schema and security policies
scripts/seed.ts       creates logins, household, categories (and synthetic data)
tests/
```

### Data model

`profiles` (one per login) · `households` · `household_members` · `accounts` ·
`categories` (two levels via `parent_id`) · `transactions`.

- Amounts are signed: negative is money out, positive is money in.
- `transaction_type` decides what counts as spending, not the sign. Only
  `expense` and `refund` count; `transfer`, `credit_card_payment` and
  investment moves never do, so paying a card bill is not double counted.
- `is_transfer` is computed by the database from `transaction_type`.
- `person_id` is who paid; empty means shared household (joint account).
- **Paying each other back** (`reimbursement`): money between the two of you
  that settles a shared cost. It never counts as household spending, but moves
  personal spending from the receiver to the sender (`counterparty_id`). Only the
  receiving side's row is used, so a payback seen in both accounts counts once.
  Example: John buys $400 of groceries, Jane sends him $200 → household
  $400, John $200, Jane $200.
- Composite foreign keys stop a transaction from pointing at another
  household's account, category or person, and stop a subcategory from being
  paired with the wrong category.
- There are no columns for account numbers, routing numbers, card numbers or
  credentials. `last_four` is optional and limited to four digits.

Two deliberate differences from the original spec's field list: there is a
single `review_status` (`auto_categorized` / `needs_review` / `reviewed`)
instead of both `is_reviewed` and `review_status`, and
`normalized_merchant` + `original_description` instead of a third `merchant`
column.

## Local setup

Requires Node 20.9+ (developed on Node 26).

```bash
npm install
npm run dev        # http://localhost:3000
```

With no `.env.local`, the app runs in **demo mode**: a year of synthetic data,
no login. `npm run demo` shows the same demo on port 3100 even when
`.env.local` is set up for a real database, which it then never contacts.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run demo` | The demo household, on port 3100 |
| `npm test` | All tests |
| `npm run typecheck` | Type check |
| `npm run lint` | Lint |
| `npm run build` | Production build |
| `npm run db:seed` | Demo logins + household + synthetic transactions in Supabase |
| `npm run db:bootstrap` | Logins + household + default categories only (for real use) |
| `npm run ai:check` | Tests the Anthropic API key with four made-up merchants (well under a cent) |

## Environment variables

Copy `.env.example` to `.env.local`.

| Variable | Where it is used | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | app + scripts | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app | anon / publishable key; limited by Row Level Security |
| `SUPABASE_SERVICE_ROLE_KEY` | setup scripts only | Bypasses security. Keep it on your machine; do not add it to Vercel |
| `ANTHROPIC_API_KEY` | app + `npm run ai:check` | Optional. Enables AI sorting of unfamiliar merchants. Server-only; add to Vercel too |
| `SEED_USER_PASSWORD`, `SEED_PERSON1_NAME`, `SEED_PERSON1_EMAIL`, `SEED_PERSON2_NAME`, `SEED_PERSON2_EMAIL`, `SEED_HOUSEHOLD_NAME` | setup scripts | Logins and household to create |
| `HOUSEHOLD_TIME_ZONE` | app | Defines "today" and "this week". Default `America/New_York` |
| `HOUSEHOLD_WEEK_STARTS_ON` | app | `sunday` (default) or `monday`. Sunday Review opens on the week containing yesterday |
| `HOUSEHOLD_OTHER_ALERT_DOLLARS` | app | Point out "Other" spending above this many dollars a month. Default 200 |
| `HOUSEHOLD_SHARED_SPENDING_IN_PERSONAL` | app | `separate` (default): shared bills stay under Shared. `split`: each person's view includes an equal share |
| `DEMO_MODE` | app | `true` allows demo mode in a production build |

## Supabase setup

1. Create a free project at supabase.com.
2. **Apply the schema.** Either paste
   `supabase/migrations/20261001000000_initial_schema.sql` into the SQL Editor
   and run it, or use the CLI:
   ```bash
   npx supabase init          # once; creates supabase/config.toml
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   Later migrations are new files in `supabase/migrations/`, applied the same
   way, in filename order: `…_initial_schema.sql`, `…_import_fingerprint.sql`,
   `…_categorization_rules.sql`, `…_budgets.sql`, `…_catch_up_and_ai.sql`,
   `…_manual_transactions.sql`, `…_recurring_overrides.sql`, `…_net_worth.sql`,
   `…_private_transactions.sql`, `…_income_sources.sql`.
3. **Turn off public sign-ups**: Authentication → Sign In / Providers → disable
   "Allow new users to sign up". Logins are created by the setup script.
4. **Allow the email-link landing page**: Authentication → URL Configuration →
   set Site URL to your app URL and add `http://localhost:3000/auth/confirm`
   and `https://<your-app>.vercel.app/auth/confirm` to Redirect URLs.
5. Fill in `.env.local`, then create the household:
   ```bash
   npm run db:seed                 # synthetic demo household, or
   npm run db:bootstrap            # empty household for your real emails
   npm run db:seed -- --reset      # replace an existing household of the same name
   ```
   Both people then sign in with their email and `SEED_USER_PASSWORD`, and can
   change it with "Forgot password?".

Supabase's built-in email sender is rate-limited to a few messages per hour,
which is fine for two people.

## Deployment (Vercel)

1. Push the repository to GitHub (private).
2. Import it in Vercel.
3. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   optionally `HOUSEHOLD_TIME_ZONE` and `HOUSEHOLD_WEEK_STARTS_ON`. Do not add the service-role key.
4. Deploy, then add the Vercel URL to Supabase's Site URL / Redirect URLs.

Vercel Hobby and Supabase Free cover this app. Supabase pauses free projects
after about a week without activity; a weekly Sunday review keeps it awake,
and a paused project can be resumed from the dashboard.

## Security

- **Database-level isolation.** Every table has Row Level Security. A signed-in
  person can only read and write rows of households they belong to; signed-out
  requests have no table privileges at all. `tests/database.test.ts` proves this
  against the real migration.
- **Three layers of sign-in checks:** `proxy.ts` redirects early, each page
  re-checks the session, and the database enforces access regardless.
- **Membership is not self-service.** People cannot add themselves to a
  household; only the setup script (service role) can.
- **Least data.** No account/routing/card numbers or credentials are stored.
- **Secrets** live in `.env.local` (git-ignored). The service-role key is never
  used by the deployed app. `.gitignore` also blocks `*.csv`, statements and
  spreadsheets so real financial files cannot be committed by accident.
- **Minimal data to AI.** Only when `ANTHROPIC_API_KEY` is set, and only
  merchant names and bank category labels. Never raw files, amounts, dates,
  accounts or people's names.
- Pages are marked `noindex`.

## CSV importer architecture

```
In the browser (the raw file never leaves the device):
  raw CSV → parse → find header row → detect institution
          → drop sensitive columns → adapter → NormalizedTransaction
On the server (server actions in src/app/(app)/import/actions.ts):
  validate → classify type → normalize merchant → fingerprint → skip duplicates → save
```

| File in `src/lib/import/` | Job |
| --- | --- |
| `csv.ts` | CSV reader (quotes, embedded commas and line breaks) |
| `parse-file.ts` | Finds the header row, picks the adapter, collects unreadable rows |
| `adapters.ts` | One adapter per bank layout; converts to negative = money out |
| `sensitive.ts` | Finds and drops account/card/routing/SSN/login columns |
| `classify.ts` | Expense, income, transfer, card payment, refund, investment |
| `merchant.ts` | Known-merchant patterns plus generic clean-up |
| `prepare.ts` | Validates browser input, builds rows, fingerprints, splits duplicates |

- **Privacy.** Files are parsed in the browser. Only date, description, amount
  and (hashed into the fingerprint) the bank's reference id are sent on.
  Balances, addresses and account identifiers are never sent or stored.
- **Duplicates.** Each row gets a fingerprint from account, date, amount and
  the bank's reference (or the description), plus a counter for identical rows
  within one file. Re-uploading a file or an overlapping date range skips what
  is already saved, while two genuine identical purchases on one day are both
  kept. A unique index on `(account_id, source_hash)` backs this up.
- **Transfers.** Card payments, transfers between own accounts, and Zelle
  between household members are typed as such and never counted as spending.
  Zelle with anyone else and unexplained deposits are flagged for review.
- **Person.** An imported transaction belongs to the owner of its account;
  joint accounts are shared household.
- **Limits.** 10 files per import, 5 MB and 5,000 rows per file.

Supported layouts: Truist; American Express; Chase checking/savings and credit
card; Bank of America checking/savings and credit card. Investment exports are
recognized and declined. Vanguard and Coinbase are planned with net worth.

### Adding an institution

1. Add an `InstitutionAdapter` to `src/lib/import/adapters.ts`: `matches(headers)`
   recognizes the lowercased header row, `parseRow(row)` returns a transaction
   (convert the bank's sign convention to negative = money out), a skip, or a
   problem description.
2. Add it to the `ADAPTERS` array in the same file.
3. Add a test with a small **synthetic** CSV sample to `tests/import.test.ts`.

## Views: Everyone, each person, Shared

The dashboard and reports can be switched between four views. The rules live in
`src/lib/finance/views.ts`:

| View | Spending | Also shown |
| --- | --- | --- |
| Everyone | all purchases | who spent it |
| A person | what they paid, after paybacks between you | what they paid into the shared account |
| Shared | purchases from the joint account | what each of you paid in |

Everyone always equals John + Jane + Shared. "Left over" for a person is
income − spending − paid into shared; for Shared it is paid in + income − spending.

Who paid into the joint account comes from the deposit on the joint account
("Zelle from John"). The matching withdrawal from the person's own account
can look like a payment to the other person (some banks show a Zelle into a joint
account under the joint account holder's name), so withdrawals are paired with deposits of the same
amount within four days and treated as transfers
(`src/lib/finance/shared-account.ts`). This runs after every import, and for
older data from Settings → Sorting rules → "Re-check existing transactions".

To give each person an equal share of shared bills instead, set
`HOUSEHOLD_SHARED_SPENDING_IN_PERSONAL=split`.

**Weeks.** The dashboard has a Month / Week toggle; Sunday Review is weekly and
has the same view switcher; Transactions can be filtered to a week; Reports can
be weekly. Weeks follow `HOUSEHOLD_WEEK_STARTS_ON`. Budgets are monthly, so a
week shows the budget of the month it falls in.

**Reports** show categories (or detailed subcategories) by month or week for any
view, with totals, averages and a CSV download. Text cells in the download are
protected against spreadsheet formula injection.

## Catch-up and AI sorting

Importing months of history shouldn't mean reviewing it all. Three layers sort
transactions, cheapest first:

1. **Rules (free, local).** A library of a few hundred well-known merchants
   (`src/lib/import/merchant-library.ts`) drives both name clean-up and the
   built-in rules, plus the banks' own category labels.
2. **Catch-up.** The household's *review start date* (`households.review_starts_on`,
   set on the Catch-up page) splits history from the weekly routine. Before it,
   suggestions are accepted automatically and whatever is left is grouped by
   merchant on `/catch-up`, so one decision sorts every past transaction from
   that merchant and teaches a rule. Sunday Review only covers the start date on.
3. **AI (optional).** With `ANTHROPIC_API_KEY` set, merchants no rule knows are
   sent to Claude Haiku 4.5 after each import (and on demand from Catch-up).
   Only the cleaned-up merchant name and the bank's category label are sent —
   never amounts, dates, accounts, descriptions, or payment-app names (which
   are people). The answer is constrained to the category list with structured
   output, saved as a rule (`source = 'ai'`): confident answers sort
   automatically, unsure ones only suggest. Each merchant is asked about once.
   Cost is a few cents for a large history; `npm run ai:check` tests the key
   with four made-up merchants.

The Catch-up page also shows how history was sorted (rules, bank labels, AI,
you) and a spot-check sample. The Import screen can ignore rows before a date.

## Transactions added by hand

**+ Add** on Transactions (and Sunday Review) records a purchase that hasn't
posted yet, or cash. It counts right away. If it's expected in a bank download
(`awaiting_post`), each import looks for its bank version: same account, dated
3 days before to 7 days after, amount within 25% (so tips are fine). A match
replaces the entry instead of adding a second copy, keeping the person's
category and note; the preview says "Replaces your entry". Entries still not
posted after 10 days are listed in Sunday Review to delete or keep. Cash
entries (an account whose bank is "Cash") never wait. Matching:
`src/lib/import/manual-match.ts`.

## Recurring charges and subscriptions

Detected from history on the fly (`src/lib/finance/recurring.ts`), never sent
anywhere. Transactions are grouped by merchant, whether they're a charge or
income, and whose they are. A group is recurring when the gaps between dates
fit a rhythm (weekly, every 2 weeks, twice a month on fixed days such as the
6th and 21st, monthly — including once a month on varying days — every 3 or 6
months, yearly) and the amounts are steady. One-off charges from a regular
merchant (a yearly fee, a lump payment) are set aside first, so they neither
hide the pattern nor count as a price change. Amounts must be steady: frequent charges must stay within about 10% (so coffee
and grocery habits aren't flagged), monthly-or-longer bills within about 35%
(so utilities are). Three occurrences are needed, or two for rhythms of three
months or more with near-identical amounts.

Each item has its latest amount, monthly and yearly cost, next expected date,
category, owner (person or Shared), confidence, whether it seems to have
stopped, whether it's new, and any recent price change. The Recurring page
works per view and groups subscriptions, bills and income; the dashboard shows
what's coming up in two weeks, and Sunday Review notes new recurring charges
and price changes. "Not recurring" and "It stopped" are remembered in
`recurring_overrides`; nothing ever recommends cancelling.

## Net worth

Accounts double as net-worth items; a home, a vehicle and loans can be added just
for net worth. Balances (`account_balances`) are dated snapshots of what an
asset is worth or what is owed on a debt (cards, mortgage, loans count as
debts). An account's balance on a date is its latest snapshot on or before it.
Balances typed in replace an imported one for the same day.

Truist ("Daily Posted Balance") and Bank of America ("Running Bal.") exports
include balances, so each import records the account's balance on the file's
last date automatically; only that one number is sent, not per-row balances.

The Net Worth page works per view (Everyone, each person's own accounts, the
shared ones), shows owned/owed/net and the change since last month, a
month-by-month history (month-end balances), flags balances older than 45 days,
and lets accounts be retired (closed, sold, paid off) without losing history.
Logic: `src/lib/finance/net-worth.ts`.

## Private transactions

A person can keep one of their own purchases or refunds private — say, a
present — optionally until a date. This is enforced by Row Level Security
(`can_see_transaction`), not the app: the other member's queries don't return
the row, so their lists, totals, budgets, reports and recurring charges are all
computed without it. On the reveal date it becomes visible again automatically.
The owner still sees and counts it, but lists, Sunday Review and Catch-up show
it as "Private purchase" in case a screen is shared. Private purchases never
teach sorting rules (rules are shared) and are never sent to the AI. The control
is a quiet "Keep private" link on the transaction's page, plus a checkbox when
adding a transaction by hand.

## Forecasting

`src/lib/finance/forecast.ts`, per view, for this month or next — no machine
learning; every number traces back to history, recurring charges or expected
income (spec §26, §31, §32):

- **Projected spending** = spent so far + recurring charges still to come (on
  their expected dates) + everyday spending for the rest of the month (the
  typical month of the last three, after taking out recurring bills and
  irregular spending) + irregular spending (gifts, medical, travel…; averaged
  over up to six months). The range uses the lowest and highest recent months.
- **Cash flow**: income received so far + paydays still to come − projected
  spending (− what a person usually pays into the shared account, or + what
  both pay in, for Shared) = projected left over.
- **Three baselines** side by side: average month, recent months weighted
  3-2-1, and the detailed breakdown.
- **Expected income** (`income_sources`): people enter paychecks (weekly, every
  two weeks, twice a month on set days, monthly) so forecasts are right before
  several paychecks have been seen; anyone without an entry falls back to
  detected recurring income.

Only months the household's data fully covers count as history. The dashboard's
"Projected" number comes from the same forecast.

## Budgets

A budget line is a monthly amount for a category (or one subcategory) in one
view (`budget_lines`): household-wide, one person, or the shared account. The
Everyone page shows the whole plan, with each person's and the shared account's
lines labelled; a person's page or Shared shows only their own. A category can't
be budgeted both household-wide and per person, so nothing is counted twice.

Kinds: **fixed bill**, **everyday spending**, **personal allowance**, and
**saving up** (a sinking fund: the monthly amount accumulates, spending draws it
down, and what's unspent carries over). "Left to spend" counts everyday spending
and allowances.

Changing or removing a line applies from the month being viewed on; earlier
months keep the budget they had (the old line gets an end month and a new one
starts). "Suggest budgets from my recent spending" adds a line for each category
with recent spending and no budget, set to the recent average, rounded up.

Logic: `src/lib/finance/budgets.ts`; loading: `src/lib/finance/load-budget.ts`.

## Categories and rules

Categories are two levels (e.g. Food › Groceries), stored as data and editable
in Settings. Hidden categories keep their history but leave the pickers.

Rules (`categorization_rules`) decide a purchase's category. The most specific
match wins: **merchant** (exact cleaned-up name) → **description** (whole words)
→ **bank's category** (Truist and Amex include their own labels). Each rule either
*sorts automatically* or *suggests* (the purchase still goes to review). Only
expenses and refunds are categorized.

Built-in rules live in `src/lib/categories/default-rules.ts`. A new household gets
them from the setup script; an existing one can add any missing ones from
Settings → Sorting rules.

**Learning from review** (`learnFromChoice` in `src/lib/categories/rules.ts`):

- ticking "Always use this category" makes an automatic merchant rule and sorts
  other waiting purchases from that merchant right away;
- leaving it unticked saves the choice as a suggestion for next time;
- choosing a different category for a merchant that had an automatic rule
  downgrades it to a suggestion, so merchants like Amazon aren't forced into one
  category. "Always" starts unticked for such merchants.

Spending filed under **Other** above `HOUSEHOLD_OTHER_ALERT_DOLLARS` (default 200)
in a month is pointed out on the dashboard and in Sunday Review.

## Tests

`npm test` covers date and money helpers, spending maths (transfers, card
payments, refunds, month boundaries), the seed generator, route protection,
sensitive-column detection, the CSV reader, every bank adapter, merchant
names, transaction-type detection (including paybacks), duplicate
fingerprints, input validation, rule matching and learning, review decisions,
personal vs household totals, the four views, shared-account pairing,
month-end projections, reports and CSV safety, budgets (progress, saving-up
funds, versioning, overlap rules), month and week periods,
and — against real Postgres via PGlite — the schema constraints and household
isolation.

Not covered by automated tests: the live Supabase sign-in flows and the
screens themselves (import, review, settings), which need a browser.
