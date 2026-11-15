import "server-only";
import { getDataSource, type HouseholdContext } from "@/lib/data";
import { buildReport } from "./report";
import type { ReportOptions } from "./report-options";
import { viewEntries } from "./views";
import { viewOptions } from "@/lib/finance/view-options";

export async function loadReport(session: HouseholdContext, options: ReportOptions) {
  const data = getDataSource();
  const householdId = session.household.id;
  const { periods } = options;
  const [categories, transactions] = await Promise.all([
    data.listCategories(householdId),
    data.listTransactions(householdId, { from: periods[0].from, to: periods[periods.length - 1].to }),
  ]);
  const entries = viewEntries(transactions.rows, options.view, viewOptions(session));
  return { categories, report: buildReport(entries, periods, categories, options.level, options.view) };
}
