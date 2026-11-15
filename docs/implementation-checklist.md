# Usability & correctness pass — implementation checklist

Status values: **pending** · **implemented** (code in place) · **verified** (tests and/or rendered check done) · **blocked**.

Baseline (before this work): 320 tests passing, typecheck clean, lint clean.
After phase 1: 371 tests passing, typecheck and lint clean.
After phases 2–3 (import, splits, undo): 411 tests passing.
Final: 419 tests passing; typecheck, lint and production build clean.

## A. Correctness and privacy

| # | Requirement | Status | Notes |
|---|---|---|---|
| A1 | Private manual purchase stays private when its bank version posts | verified | `mergeWithEntry` keeps `is_private`/`private_until`; unit, action and PGlite tests (partner can't see row or totals; their later import is a quiet duplicate). Match previews and "still waiting" lists mask private entries. |
| A2 | Forecast signs (shortfall, withdrawals, refunds) | verified | `cashFlowLines` effects sum exactly to the result in every view; tests for shortfall, zero, withdrawals, refunds. Rendered: "Projected shortfall" / signed lines. |
| A3 | Reveal dates use the household calendar in app and RLS | verified | `households.time_zone` + `household_today()`; RLS and app share it; Settings → Household calendar. Tests: local midnight, DST both ways, two zones a day apart, both members. |
| A4 | Retiring an account keeps net-worth history | verified | `accounts.closed_on`; retire asks "Closed, sold, or paid off on what date?" + optional final balance; tests prove earlier months unchanged; restore clears it. |
| A5 | Budget version changes are atomic | verified | `create/change/end_budget_line` SQL functions (invoker, household lock, stale check). PGlite tests: failure leaves nothing half-done, stale edit refused, other household refused. |

## B. Weekly workflow

| # | Requirement | Status | Notes |
|---|---|---|---|
| B1 | Import completion → Review / Dashboard, precise counts | verified | Done screen: "Review N transactions" (all waiting; this import's share stated separately) or "Check dashboard"; Catch-up/Transactions/Import more secondary. Counts from `import_batch_id`, tested. |
| B2 | Review scope: week summary vs. all waiting, week-only filter, focus after save | implemented | Separate "All waiting decisions — includes earlier weeks" and "This week's summary", "Selected week only", view/week kept in links, "Back to dashboard", announced saves, focus moves to next card. Rendered at 375/1366. |
| B3 | Operation-level Undo for review decisions | verified | `review_operations` (own-only RLS) + `undo_review_operation()` (all-or-nothing, refuses on any newer change). Tests: restores rows + rule + sorted rows + removed split; refuses after partner edit; once only; other person can't see/undo. |
| B4 | First-use checklist, review start vs. import cutoff | implemented | Dashboard "Getting started" checklist (import → review start → check items), Import in empty states and status bar, "Joint means purchases appear under Shared", review start explained as distinct from the import cutoff. Admin-controlled membership unchanged. |
| B5 | Confirm or reject manual-entry matches | verified | Merchant similarity as evidence; strong = names agree and no alternatives; ambiguous need "Same purchase"/"Keep separate" before import; answers revalidated at save. Tests: similar amounts, tips, multiple candidates, repeated imports. |
| B6 | Per-account confirmed coverage | verified | Import asks "Activity downloaded through"; coverage card on Import + dashboard status ("N of M accounts updated through…"); confirm-no-activity; estimates labelled; budget/forecast/pace/usual/report columns use complete months and label partial data. Tests for gaps, late-starting accounts, retired accounts, privacy of backfill. |

## C. Import resilience

| # | Requirement | Status | Notes |
|---|---|---|---|
| C1 | Explicit import stages, busy states | verified | Stage list announced; file input locked while reading; parsing yields between files (worker unnecessary at 5 MB/5,000-row limits). Browser-driven: stages, focus to preview heading. |
| C2 | Recoverable partial success, idempotent retry | verified | `import_batches` keyed by a browser-chosen id; save and sort are separate actions; partial save reports "N saved… try again"; sort failure keeps "Transactions saved"; Import page offers "Finish sorting". Tests inject failures mid-save and mid-sort. |
| C3 | Mark own imported purchases private before saving | verified | Preview "Private" column for own purchases/refunds + optional reveal date; applied before insert; server rejects others' rows. Tests: saved private, not sent to AI, invisible to partner. |
| C4 | Same-name files, reset cutoff, headers, unreadable rows | verified | Browser-driven: identical file refused with a message, different same-name file shown as "(2)"; Start over resets cutoff; preview tables have headers/captions; unreadable rows called out as excluded. |

## D. Visual design and layout

| # | Requirement | Status | Notes |
|---|---|---|---|
| D1 | Phone dashboard order | verified | Phone order: controls → review/coverage status → spent so far + everyday budget left → budget exceptions → categories → coming up → supporting figures/trends. 375px render, no overflow. |
| D2 | Desktop hierarchy | verified | Primary spending figure (with typical-pace comparison and projection), secondary budget left, supporting figures grouped; review status as an action bar. 1366px render, light + dark. |
| D3 | Budget states (within / over / fixed bills) | verified | `budgetStatus` shared by dashboard, Budget and Month-end: teal within, amber + hatched end + ▲ text when over, grey fixed bills ("Charged the budgeted amount", never "Paid"). |
| D4 | No stretched dashboard cards | verified | Two content-sized columns (`items-start`), no stretched cards; Budget page goes full width when there's no side panel. |
| D5 | Grouped desktop navigation | verified | Sidebar grouped: Weekly routine / Planning / History / Administration; More page uses the same groups; phone tabs unchanged, Import on Home. |
| D6 | Simplified transaction filters, chips | verified | Search + Period + "Filters (N)" disclosure, removable chips, Clear all; GET URLs and pagination kept; rows lead with merchant/category/amount, descriptions truncated; whole-row tap targets on phone/tablet. |
| D7 | Layered forecast | verified | Answer first, signed breakdown, bills/paychecks/method behind disclosures; three-method comparison inside "How this estimate works". |
| D8 | Typography and control consistency | verified | `styles.ts` controls, type scale (24–28 / 16 / 14 / 12–13px), uppercase removed from figures, period label beside arrows (Charts, Budget, Reports, Review, Month-end), long names wrap or truncate with full text available. |
| D9 | Accessibility details | verified | aria-pressed chips; ≥36–44px targets; global focus ring (measured: 2px solid); errors linked with aria-describedby; live regions for saves/stages; contrast measured ≥4.5:1 in all 6 theme/mode combos (lowest 4.60); reduced motion; purchase chart = one linked table of every purchase, dots no longer tab stops; reports: phone summary + scrollable labelled table. |

## E. Budget and report clarity

| # | Requirement | Status | Notes |
|---|---|---|---|
| E1 | Budget suggestions previewed and confirmed | implemented | `previewSuggestedBudgets` → editable list → `addSuggestedBudgets`. |
| E2 | Personal budget empty state links to Everyone | implemented | |
| E3 | Actionable budget conflicts | implemented | Error names the existing line and links to its view. |
| E4 | "Paid in by both of you" in UI and CSV | verified | "Paid in by both of you" in dashboard, forecast, reports and CSV. |
| E5 | Split-mode budgets don't double count | implemented | Personal+shared line for one category conflicts in split mode (TS + SQL); shares are whole cents that add up exactly. |
| E6 | Exact vs. rounded values distinguishable | implemented | Rounded figures say so ("rounded to whole dollars; the CSV has exact cents"), exact cents in cell tooltips, budget rows and ledger. |

## F. Larger features

| # | Requirement | Status | Notes |
|---|---|---|---|
| F1 | Split purchases (+ linked refunds) | verified | `transaction_splits` + `save_transaction_splits()` (exact cents, same sign, 2–20 parts), RLS follows parent (privacy inherited), stale split cleared on amount/kind change. Totals use parts in views, summaries, budgets, reports, forecasts, charts. Refund linking reverses chosen parts; refund of a private purchase becomes private. Tests at DB, money and action level. |
| F2 | Month-end review | implemented | `/month-end`: select month → coverage (gaps per account) → decisions → budget vs actual → balances → downloads; close records a shared-only snapshot and later changes are explained, never locked. Reports gained "Completed only" and an end month; partial columns labelled. |
| F3 | Ledger export and versioned backup | verified | `/reports/ledger` (exact cents, one line per part, formula-safe) and `/settings/backup` (versioned JSON, privacy note); both read through the user's own RLS. Tests: exact amounts, sums match app totals, formula injection, round trip, broken-reference detection. |

## Final checks

| Check | Status | Notes |
|---|---|---|
| Vitest | verified | 419 passing (26 files) |
| Typecheck | verified | clean |
| Lint | verified | clean |
| Production build | verified | `next build` succeeds |
| Migrations + RLS tested locally (PGlite) | verified | 8 new migrations applied in order in tests; RLS for splits, undo, imports, coverage, closings |
| Rendered checks at 375 / 768 / 1366 px | verified | 18 pages × 3 widths: no overflow, no script errors; dark mode checked; import flow driven in a real browser |
| Demo mode works without a database | verified | all pages render in `npm run demo` |
| README updated | verified | features, migration list, time zone, tests |

## Decisions and known limitations

- **Coverage requirement:** an account counts toward month completeness once it has any recorded coverage. Accounts never imported (net-worth-only) don't block history; they're listed as "not imported yet". Existing data gets *estimated* coverage (first→last non-private imported transaction per account), labelled as an estimate.
- **Closing dates:** an account counts in net worth on dates *before* `closed_on`. Accounts retired before this change count through their last balance.
- **Split mode:** each person's share of shared spending is whole cents; leftover cents go to members in a fixed order, so shares sum exactly.
- **Split semantics:** parts inherit the purchase's person (who paid); moving costs between people stays with paybacks. Splits never teach rules; recurring detection still uses the whole bank amount; "fix this merchant everywhere" skips split purchases. Choosing a single category for a split purchase removes its split (undoable).
- **Undo scope:** review decisions (queue and transaction page). Undo refuses entirely if any touched row or rule changed since — it never partially undoes.
- **Known limitation (privacy):** if the *other* person imports your card's file before you do, your private hand-added entry can't be matched (they can't see it), so their import adds the bank row as a normal transaction. Cards are personal, so this is unusual; noted rather than solved with a leak-prone workaround.
- **Not exercised end to end:** writes through a live Supabase project (the demo is read-only). Write paths are covered by PGlite (real migrations + RLS) and in-memory action tests instead.
- **Operator steps remaining:** apply migrations `20261012…` through `20261019…` in order on the live project, then check Settings → Household calendar.
