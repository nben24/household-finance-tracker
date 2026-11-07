import "server-only";
import { SHARED_SPENDING_MODE } from "@/lib/config";
import { getDataSource, type HouseholdContext } from "@/lib/data";
import { buildReport } from "./report";
import type { ReportOptions } from "./report-options";
import { viewEntries } from "./views";

export async function loadReport(session: HouseholdContext, options: ReportOptions) {
  const data = getDataSource();
  const householdId = session.household.id;
  const { periods } = options;
  const [categories, transactions] = await Promise.all([
    data.listCategories(householdId),
    data.listTransactions(householdId, { from: periods[0].from, to: periods[periods.length - 1].to }),
  ]);
  const entries = viewEntries(transactions.rows, options.view, {
    memberCount: session.members.length,
    mode: SHARED_SPENDING_MODE,
  });
  return { categories, report: buildReport(entries, periods, categories, options.level, options.view) };
}
