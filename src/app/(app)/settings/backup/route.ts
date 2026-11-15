import { getDataSource, requireHousehold } from "@/lib/data";
import { buildBackup } from "@/lib/finance/export";
import { householdToday } from "@/lib/household-time";

export const dynamic = "force-dynamic";

/**
 * A versioned backup of everything you can see: transactions (with split
 * parts), accounts, balances, coverage, categories, rules, budgets, income and
 * recurring settings. Read through your own permissions, never an admin key.
 */
export async function GET() {
  const session = await requireHousehold();
  const data = getDataSource();
  const id = session.household.id;
  const [transactions, accounts, balances, coverage, categories, rules, budgets, income, overrides] = await Promise.all([
    data.listTransactions(id),
    data.listAccounts(id),
    data.listBalances(id),
    data.listCoverage(id),
    data.listCategories(id),
    data.listRules(id),
    data.listBudgetLines(id),
    data.listIncomeSources(id),
    data.listRecurringOverrides(id),
  ]);
  const backup = buildBackup({
    exported_at: new Date().toISOString(),
    exported_by: { id: session.user.id, name: session.user.name },
    household: {
      id,
      name: session.household.name,
      review_starts_on: session.household.review_starts_on,
      time_zone: session.household.time_zone,
    },
    members: session.members.map((member) => ({ id: member.id, name: member.name })),
    accounts,
    account_balances: balances,
    account_coverage: coverage,
    categories,
    categorization_rules: rules,
    budget_lines: budgets,
    income_sources: income,
    recurring_overrides: overrides,
    transactions: transactions.rows,
  });
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="household-backup-${householdToday(session.household)}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
