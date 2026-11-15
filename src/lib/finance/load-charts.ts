import "server-only";
import { getDataSource, type HouseholdContext } from "@/lib/data";
import { loadCoverage } from "./load-coverage";
import { addMonths, monthRange } from "@/lib/dates";
import { monthlyFlow, namedCategories, purchases, spendingPace, spendingSlices } from "./charts";
import { viewEntries, type View } from "./views";
import { viewOptions } from "@/lib/finance/view-options";

/** Everything the Charts page draws, for one view, month and range. */
export async function loadCharts(
  session: HouseholdContext,
  view: View,
  month: string,
  rangeMonths: number,
  today: string,
) {
  const data = getDataSource();
  const householdId = session.household.id;
  const months = Array.from({ length: rangeMonths }, (_, index) => addMonths(month, index - rangeMonths + 1));
  // The pace chart compares with up to six months before this one.
  const from = `${addMonths(month, -Math.max(rangeMonths - 1, 6))}-01`;
  const [categories, transactions, coverage] = await Promise.all([
    data.listCategories(householdId),
    data.listTransactions(householdId, { from, to: monthRange(month).to }),
    loadCoverage(householdId),
  ]);
  const entries = viewEntries(transactions.rows, view, viewOptions(session));
  const inRange = entries.filter((entry) => entry.date >= `${months[0]}-01`);
  const named = namedCategories(inRange, categories);
  return {
    categories,
    named,
    slices: spendingSlices(entries, categories, month, named),
    flow: monthlyFlow(entries, view, months),
    pace: spendingPace(entries, month, today, coverage.isMonthComplete),
    purchases: purchases(transactions.rows, view, month, today, session.user.id),
  };
}
