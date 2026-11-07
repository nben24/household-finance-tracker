import "server-only";
import { SHARED_SPENDING_MODE } from "@/lib/config";
import { earliestTransactionDate, getDataSource, type HouseholdContext } from "@/lib/data";
import { addMonths, monthKey, monthRange } from "@/lib/dates";
import type { BudgetLineRow, CategoryRow } from "@/lib/db/types";
import {
  budgetProgress,
  budgetTotals,
  linesForView,
  unbudgetedCents,
  viewOfLine,
  type BudgetProgress,
} from "./budgets";
import { viewParam } from "./view-param";
import { averageByCategory, entriesByCategory, viewEntries, type Entry, type View } from "./views";

const AVERAGE_MONTHS = 3;

export interface BudgetPage {
  allLines: BudgetLineRow[];
  /** lines active this month in this view */
  progress: BudgetProgress[];
  totals: ReturnType<typeof budgetTotals>;
  unbudgetedCents: number;
  categories: CategoryRow[];
  /** average monthly spending over recent full months, by category id and subcategory id */
  averages: Record<string, number>;
  averageMonths: number;
}

export async function loadBudget(session: HouseholdContext, view: View, month: string): Promise<BudgetPage> {
  const data = getDataSource();
  const householdId = session.household.id;
  const [allLines, categories, dataStartsOn] = await Promise.all([
    data.listBudgetLines(householdId),
    data.listCategories(householdId),
    earliestTransactionDate(householdId),
  ]);
  const shown = linesForView(allLines, view);

  // Enough history for saving-up funds and for the recent averages.
  const fundStarts = shown.filter((line) => line.kind === "sinking_fund").map((line) => line.starts_month);
  const averageStart = `${addMonths(month, -AVERAGE_MONTHS)}-01`;
  const from = [averageStart, ...fundStarts].sort()[0];
  const transactions = await data.listTransactions(householdId, { from, to: monthRange(month).to });

  const options = { memberCount: session.members.length, mode: SHARED_SPENDING_MODE };
  const cache = new Map<string, Entry[]>();
  const entriesForView = (target: View) => {
    const key = viewParam(target);
    if (!cache.has(key)) cache.set(key, viewEntries(transactions.rows, target, options));
    return cache.get(key)!;
  };

  const progress = budgetProgress(shown, (line) => entriesForView(viewOfLine(line)), month).sort(
    (a, b) => b.budgetCents - a.budgetCents,
  );
  const viewMonthEntries = entriesForView(view).filter((entry) => monthKey(entry.date) === month);

  const averageMonths = [1, 2, 3]
    .map((back) => addMonths(month, -back))
    .filter((previous) => dataStartsOn !== null && dataStartsOn <= `${previous}-01`);
  const averages: Record<string, number> = {};
  const viewEntriesAll = entriesForView(view);
  for (const [id, cents] of averageByCategory(viewEntriesAll, categories, averageMonths.map(monthRange))) {
    if (id) averages[id] = cents;
  }
  if (averageMonths.length > 0) {
    const inMonths = viewEntriesAll.filter((entry) => averageMonths.includes(monthKey(entry.date)));
    for (const total of entriesByCategory(inMonths, categories, "subcategory")) {
      if (total.id) averages[total.id] = Math.round(total.cents / averageMonths.length);
    }
  }

  return {
    allLines,
    progress,
    totals: budgetTotals(progress),
    unbudgetedCents: unbudgetedCents(viewMonthEntries, progress),
    categories,
    averages,
    averageMonths: averageMonths.length,
  };
}

