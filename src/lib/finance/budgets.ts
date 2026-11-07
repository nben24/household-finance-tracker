// Budgets: how much each view plans to spend per category, and how it's going.

import { monthKey } from "@/lib/dates";
import type { BudgetKind, BudgetLineRow, BudgetScope, CategoryRow, ExpenseType } from "@/lib/db/types";
import { toCents } from "@/lib/money";
import type { Entry, View } from "./views";

type Line = Pick<
  BudgetLineRow,
  "id" | "scope" | "person_id" | "category_id" | "subcategory_id" | "kind" | "amount" | "starts_month" | "ends_month"
>;

export function scopeOf(view: View): { scope: BudgetScope; person_id: string | null } {
  if (view.kind === "person") return { scope: "person", person_id: view.personId };
  return { scope: view.kind, person_id: null };
}

/** The view a line's spending is measured in. */
export function viewOfLine(line: Pick<Line, "scope" | "person_id">): View {
  if (line.scope === "person" && line.person_id) return { kind: "person", personId: line.person_id };
  return { kind: line.scope === "shared" ? "shared" : "everyone" };
}

/**
 * Lines shown in a view. Everyone sees the whole household plan (household-wide
 * lines plus each person's and the shared account's); a person or Shared sees
 * only their own.
 */
export function linesForView<T extends Line>(lines: T[], view: View): T[] {
  if (view.kind === "everyone") return lines;
  const { scope, person_id } = scopeOf(view);
  return lines.filter((line) => line.scope === scope && line.person_id === person_id);
}

/**
 * Whether a new line would count spending another active line already counts:
 * same category in the same view, or the same category household-wide and per
 * person/shared.
 */
export function conflictsWith(
  candidate: Pick<Line, "scope" | "person_id" | "category_id" | "subcategory_id">,
  active: Pick<Line, "scope" | "person_id" | "category_id" | "subcategory_id">[],
): boolean {
  return active.some(
    (line) =>
      overlaps(line, candidate) &&
      ((line.scope === candidate.scope && line.person_id === candidate.person_id) ||
        line.scope === "everyone" ||
        candidate.scope === "everyone"),
  );
}

const firstOf = (month: string) => `${month}-01`;
const monthNumber = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

/** Lines in effect during the given 'YYYY-MM'. */
export function activeIn<T extends Line>(lines: T[], month: string): T[] {
  const day = firstOf(month);
  return lines.filter((line) => line.starts_month <= day && (line.ends_month === null || line.ends_month >= day));
}

/** Whether a budget line covers a piece of spending. */
export function covers(line: Pick<Line, "category_id" | "subcategory_id">, entry: Pick<Entry, "categoryId" | "subcategoryId">) {
  return entry.categoryId === line.category_id && (line.subcategory_id === null || entry.subcategoryId === line.subcategory_id);
}

/** Two lines would count the same spending: same category, and either covers the whole category or both the same subcategory. */
export function overlaps(a: Pick<Line, "category_id" | "subcategory_id">, b: Pick<Line, "category_id" | "subcategory_id">) {
  return (
    a.category_id === b.category_id &&
    (a.subcategory_id === null || b.subcategory_id === null || a.subcategory_id === b.subcategory_id)
  );
}

export interface FundStatus {
  /** set aside so far, across every version of this fund */
  savedCents: number;
  /** spent from it so far */
  spentCents: number;
  availableCents: number;
}

export interface BudgetProgress {
  line: Line;
  budgetCents: number;
  spentCents: number;
  /** budget − spent; for a fund, what's available */
  remainingCents: number;
  fund?: FundStatus;
}

function spendingCovered(entries: Entry[], line: Pick<Line, "category_id" | "subcategory_id">, from: string, to: string) {
  return Math.round(
    entries
      .filter((entry) => entry.kind === "spending" && entry.date >= from && entry.date <= to && covers(line, entry))
      .reduce((total, entry) => total + entry.cents, 0),
  );
}

/** Versions of the same fund: same view, category and subcategory. */
function sameFund(a: Line, b: Line) {
  return (
    a.kind === "sinking_fund" &&
    b.kind === "sinking_fund" &&
    a.scope === b.scope &&
    a.person_id === b.person_id &&
    a.category_id === b.category_id &&
    a.subcategory_id === b.subcategory_id
  );
}

/**
 * @param allLines every line shown in this view (all months), for fund history
 * @param entriesFor the entries of the view a line belongs to (see viewOfLine),
 *   from at least the earliest fund start to the end of `month`
 */
export function budgetProgress(allLines: Line[], entriesFor: (line: Line) => Entry[], month: string): BudgetProgress[] {
  const monthStart = firstOf(month);
  const monthEnd = `${month}-31`;
  return activeIn(allLines, month).map((line) => {
    const entries = entriesFor(line);
    const budgetCents = toCents(line.amount);
    const spentCents = spendingCovered(entries, line, monthStart, monthEnd);
    if (line.kind !== "sinking_fund") {
      return { line, budgetCents, spentCents, remainingCents: budgetCents - spentCents };
    }
    const versions = allLines.filter((other) => sameFund(line, other) && other.starts_month <= monthStart);
    let savedCents = 0;
    for (const version of versions) {
      const last = version.ends_month && version.ends_month < monthStart ? monthKey(version.ends_month) : month;
      const months = monthNumber(last) - monthNumber(monthKey(version.starts_month)) + 1;
      savedCents += toCents(version.amount) * Math.max(0, months);
    }
    const firstStart = versions.reduce((first, version) => (version.starts_month < first ? version.starts_month : first), monthStart);
    const fundSpent = spendingCovered(entries, line, firstStart, monthEnd);
    const fund = { savedCents, spentCents: fundSpent, availableCents: savedCents - fundSpent };
    return { line, budgetCents, spentCents, remainingCents: fund.availableCents, fund };
  });
}

/** The view's spending in the month that no budget line accounts for. */
export function unbudgetedCents(viewEntriesForMonth: Entry[], progress: BudgetProgress[]): number {
  const total = viewEntriesForMonth
    .filter((entry) => entry.kind === "spending")
    .reduce((sum, entry) => sum + entry.cents, 0);
  return Math.round(total) - progress.reduce((sum, p) => sum + p.spentCents, 0);
}

export interface BudgetTotals {
  budgetCents: number;
  spentCents: number;
  /** remaining across everyday spending and allowances: what's left to spend this month */
  flexibleRemainingCents: number;
}

export function budgetTotals(progress: BudgetProgress[]): BudgetTotals {
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  return {
    budgetCents: sum(progress.map((p) => p.budgetCents)),
    spentCents: sum(progress.map((p) => p.spentCents)),
    flexibleRemainingCents: sum(
      progress.filter((p) => p.line.kind === "variable" || p.line.kind === "allowance").map((p) => p.remainingCents),
    ),
  };
}

const KIND_FOR_EXPENSE_TYPE: Record<ExpenseType, BudgetKind> = {
  fixed: "fixed",
  variable: "variable",
  discretionary: "variable",
  irregular: "sinking_fund",
};

/** The budget kind that fits a category, from its subcategories' usual expense type. */
export function suggestedKind(
  categoryId: string,
  subcategoryId: string | null,
  categories: Pick<CategoryRow, "id" | "parent_id" | "default_expense_type">[],
): BudgetKind {
  const pool = subcategoryId
    ? categories.filter((c) => c.id === subcategoryId)
    : categories.filter((c) => c.parent_id === categoryId);
  const counts = new Map<ExpenseType, number>();
  for (const category of pool) {
    if (category.default_expense_type) {
      counts.set(category.default_expense_type, (counts.get(category.default_expense_type) ?? 0) + 1);
    }
  }
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return top ? KIND_FOR_EXPENSE_TYPE[top[0]] : "variable";
}

/** Rounds a suggested amount up to a tidy number. */
export function tidyAmount(cents: number): number {
  if (cents <= 0) return 0;
  const dollars = cents / 100;
  const step = dollars >= 500 ? 25 : dollars >= 100 ? 10 : 5;
  return Math.ceil(dollars / step) * step;
}
