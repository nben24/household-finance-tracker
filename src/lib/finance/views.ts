// What counts toward each view of the household's money.
//
//   Everyone  all household spending and income
//   Person    what that person paid, adjusted for paybacks between you, plus
//             what they paid into the shared (joint) account
//   Shared    spending and income on joint accounts, and who paid in
//
// With SharedSpendingMode "separate" (the default), Everyone = each person +
// Shared, exactly. With "split", each person's view also carries an equal share
// of shared spending instead of what they paid into the shared account.

import { addMonths, monthKey, monthRange } from "@/lib/dates";
import type { CategoryRow, TransactionRow } from "@/lib/db/types";
import { toCents } from "@/lib/money";
import { SAVINGS_ACCOUNT_TRANSFER } from "@/lib/import/classify";
import { isPendingSharedFunding } from "./shared-account";
import { countsAsSpending } from "./summary";

export type View = { kind: "everyone" } | { kind: "person"; personId: string } | { kind: "shared" };
export type SharedSpendingMode = "separate" | "split";

export const PAYBACK_GROUP = "payback";

type Row = Pick<
  TransactionRow,
  | "transaction_date"
  | "amount"
  | "transaction_type"
  | "person_id"
  | "counterparty_id"
  | "category_id"
  | "subcategory_id"
> &
  Partial<Pick<TransactionRow, "original_description" | "bank_category">>;

/**
 * A transfer that moves money into savings (positive) or back out of it
 * (negative), judged from the checking side: "transfer to SAV", or the bank's
 * own "transfers between own accounts" label. 0 for anything else.
 */
export function savingsMove(row: Row): number {
  if (row.transaction_type !== "transfer") return 0;
  // Only the checking side names savings ("transfer TO SAV …"); the savings side
  // says "from checking", so nothing is counted twice.
  const description = row.original_description ?? "";
  const namesSavings = /\b(SAV|SAVINGS)\b/i.test(description) || SAVINGS_ACCOUNT_TRANSFER.test(description.toUpperCase());
  const ownAccounts = /transfers between own accounts/i.test(row.bank_category ?? "");
  return namesSavings || ownAccounts ? -toCents(row.amount) : 0;
}

/** Money put into investments (positive) or taken back out (negative), from the paying account's side. */
export function investmentMove(row: Row): number {
  if (row.transaction_type === "investment_contribution" && row.amount < 0) return -toCents(row.amount);
  if (row.transaction_type === "investment_withdrawal" && row.amount > 0) return -toCents(row.amount);
  return 0;
}

export interface Entry {
  date: string;
  /** positive = adds to the total (may be fractional in "split" mode) */
  cents: number;
  kind: "spending" | "income" | "contribution" | "saved" | "invested";
  categoryId: string | null;
  subcategoryId: string | null;
  /** for contributions: who paid into the shared account */
  personId?: string;
  /** spending that is a payback between members */
  payback?: boolean;
  /** a contribution the joint account's statement doesn't show yet */
  pending?: boolean;
}

interface Options {
  memberCount: number;
  mode: SharedSpendingMode;
}

/** Money paid into a joint account by a member (recorded on the deposit row). */
function isSharedDeposit(row: Row): boolean {
  return row.transaction_type === "transfer" && row.amount > 0 && row.person_id === null && row.counterparty_id !== null;
}

/** The pieces of each transaction that count toward a view. */
export function viewEntries(rows: Row[], view: View, options: Options): Entry[] {
  const entries: Entry[] = [];
  const base = (row: Row) => ({
    date: row.transaction_date,
    categoryId: row.category_id,
    subcategoryId: row.subcategory_id,
  });

  for (const row of rows) {
    const cents = toCents(row.amount);
    const spending = countsAsSpending(row);
    const shared = row.person_id === null;
    const inView =
      view.kind === "everyone" || (view.kind === "shared" ? shared : row.person_id === view.personId);
    // Paid into the joint account straight from someone's savings: for that
    // person (and the household) it's money taken out of savings; for the
    // joint account it's simply a contribution.
    if (isSharedDeposit(row) && savingsMove(row) !== 0) {
      const forThem = view.kind === "everyone" || (view.kind === "person" && row.counterparty_id === view.personId);
      if (forThem) entries.push({ ...base(row), cents: -cents, kind: "saved" });
    } else if (inView) {
      const saved = savingsMove(row);
      if (saved !== 0) entries.push({ ...base(row), cents: saved, kind: "saved" });
      const invested = investmentMove(row);
      if (invested !== 0) entries.push({ ...base(row), cents: invested, kind: "invested" });
    }

    if (view.kind === "everyone") {
      if (spending) entries.push({ ...base(row), cents: -cents, kind: "spending" });
      if (row.transaction_type === "income") entries.push({ ...base(row), cents, kind: "income" });
      continue;
    }

    if (view.kind === "shared") {
      if (spending && shared) entries.push({ ...base(row), cents: -cents, kind: "spending" });
      if (row.transaction_type === "income" && shared) entries.push({ ...base(row), cents, kind: "income" });
      if (isSharedDeposit(row)) {
        entries.push({ ...base(row), cents, kind: "contribution", personId: row.counterparty_id! });
      }
      if (isPendingSharedFunding(row)) {
        entries.push({ ...base(row), cents: -cents, kind: "contribution", personId: row.counterparty_id!, pending: true });
      }
      continue;
    }

    const me = view.personId;
    if (spending && row.person_id === me) entries.push({ ...base(row), cents: -cents, kind: "spending" });
    if (row.transaction_type === "income" && row.person_id === me) {
      entries.push({ ...base(row), cents, kind: "income" });
    }
    // Paybacks count from the receiving side only, so they are never doubled.
    if (row.transaction_type === "reimbursement" && row.amount > 0) {
      if (row.person_id === me) entries.push({ ...base(row), cents: -cents, kind: "spending", payback: true });
      if (row.counterparty_id === me) entries.push({ ...base(row), cents, kind: "spending", payback: true });
    }
    if (options.mode === "separate" && isSharedDeposit(row) && row.counterparty_id === me) {
      entries.push({ ...base(row), cents, kind: "contribution", personId: me });
    }
    if (options.mode === "separate" && isPendingSharedFunding(row) && row.counterparty_id === me) {
      entries.push({ ...base(row), cents: -cents, kind: "contribution", personId: me, pending: true });
    }
    if (options.mode === "split" && spending && shared && options.memberCount > 0) {
      entries.push({ ...base(row), cents: -cents / options.memberCount, kind: "spending" });
    }
  }
  return entries;
}

export interface ViewTotals {
  incomeCents: number;
  spendingCents: number;
  /** person view: paid into the shared account; shared view: paid in by everyone */
  contributionCents: number;
  /** moved into savings (net of money taken back out) */
  savedCents: number;
  /** put into investments (net of withdrawals) */
  investedCents: number;
  /**
   * What's left and not set aside: income − spending − saved − invested,
   * minus contributions for a person, plus them for Shared.
   */
  netCents: number;
}

export function viewTotals(entries: Entry[], view: View): ViewTotals {
  const sum = (kind: Entry["kind"]) =>
    Math.round(entries.filter((entry) => entry.kind === kind).reduce((total, entry) => total + entry.cents, 0));
  const incomeCents = sum("income");
  const spendingCents = sum("spending");
  const contributionCents = sum("contribution");
  const savedCents = sum("saved");
  const investedCents = sum("invested");
  const contributionEffect =
    view.kind === "person" ? -contributionCents : view.kind === "shared" ? contributionCents : 0;
  return {
    incomeCents,
    spendingCents,
    contributionCents,
    savedCents,
    investedCents,
    netCents: incomeCents - spendingCents - savedCents - investedCents + contributionEffect,
  };
}

export interface CategoryTotal {
  /** category id, null for uncategorized, or PAYBACK_GROUP */
  id: string | null;
  name: string;
  cents: number;
}

/** Spending grouped by top-level category (or subcategory), largest first. */
export function entriesByCategory(
  entries: Entry[],
  categories: Pick<CategoryRow, "id" | "name">[],
  level: "category" | "subcategory" = "category",
): CategoryTotal[] {
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const totals = new Map<string | null, number>();
  for (const entry of entries) {
    if (entry.kind !== "spending") continue;
    const id = (level === "category" ? entry.categoryId : entry.subcategoryId) ?? (entry.payback ? PAYBACK_GROUP : null);
    totals.set(id, (totals.get(id) ?? 0) + entry.cents);
  }
  return [...totals.entries()]
    .map(([id, cents]) => ({
      id,
      cents: Math.round(cents),
      name:
        id === PAYBACK_GROUP ? "Paybacks between you" : id === null ? "Not yet categorized" : (names.get(id) ?? "Unknown"),
    }))
    .filter((total) => total.cents !== 0)
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
}

/** Contributions to the shared account, per person. */
export function contributionsByPerson(entries: Entry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind === "contribution" && entry.personId) {
      totals.set(entry.personId, (totals.get(entry.personId) ?? 0) + entry.cents);
    }
  }
  return totals;
}

export function spendingInRange(entries: Entry[], from: string, to: string): number {
  return Math.round(
    entries
      .filter((entry) => entry.kind === "spending" && entry.date >= from && entry.date <= to)
      .reduce((total, entry) => total + entry.cents, 0),
  );
}

/**
 * Month-end estimate: spending so far, plus what was typically spent in the
 * rest of the month over the previous three months (so bills that usually
 * arrive later in the month are included). Only months fully covered by the
 * household's data are used; null when there are none.
 *
 * @param dataStartsOn the household's earliest transaction date
 */
export function projectMonthEnd(entries: Entry[], today: string, dataStartsOn: string | null): number | null {
  const month = monthKey(today);
  const day = Number(today.slice(8));
  const soFar = spendingInRange(entries, monthRange(month).from, today);
  const usable = [1, 2, 3]
    .map((back) => addMonths(month, -back))
    .filter((previous) => dataStartsOn !== null && dataStartsOn <= `${previous}-01`);
  if (usable.length === 0) return null;

  const restOfMonth = usable.map((previous) => {
    const { to } = monthRange(previous);
    const lastDay = Number(to.slice(8));
    if (day >= lastDay) return 0;
    return spendingInRange(entries, `${previous}-${String(day + 1).padStart(2, "0")}`, to);
  });
  return soFar + Math.round(restOfMonth.reduce((a, b) => a + b, 0) / usable.length);
}

/** Average spending per category across the given date ranges (months or weeks). */
export function averageByCategory(
  entries: Entry[],
  categories: Pick<CategoryRow, "id" | "name">[],
  ranges: { from: string; to: string }[],
): Map<string | null, number> {
  const averages = new Map<string | null, number>();
  if (ranges.length === 0) return averages;
  const inRanges = entries.filter((entry) => ranges.some((range) => entry.date >= range.from && entry.date <= range.to));
  for (const total of entriesByCategory(inRanges, categories)) {
    averages.set(total.id, Math.round(total.cents / ranges.length));
  }
  return averages;
}

/**
 * Typical spending per category: the middle value across the given periods
 * (counting periods with no spending as zero). Unlike an average, one unusually
 * big purchase doesn't distort it.
 */
export function typicalByCategory(
  entries: Entry[],
  categories: Pick<CategoryRow, "id" | "name">[],
  ranges: { from: string; to: string }[],
): Map<string | null, number> {
  const typical = new Map<string | null, number>();
  if (ranges.length === 0) return typical;
  const perPeriod = ranges.map((range) =>
    new Map(
      entriesByCategory(
        entries.filter((entry) => entry.date >= range.from && entry.date <= range.to),
        categories,
      ).map((total) => [total.id, total.cents]),
    ),
  );
  const ids = new Set(perPeriod.flatMap((totals) => [...totals.keys()]));
  for (const id of ids) {
    const values = perPeriod.map((totals) => totals.get(id) ?? 0).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    typical.set(id, values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2));
  }
  return typical;
}
