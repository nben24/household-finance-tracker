import type { Metadata } from "next";
import { AddBudget, BudgetGroups, type BudgetRowView } from "@/components/budget/budget-editor";
import { Card, Metric, PageHeader, Stepper } from "@/components/ui";
import { ViewSwitcher } from "@/components/view-switcher";
import { categoryGroups } from "@/lib/categories/view";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/config";
import { requireHousehold } from "@/lib/data";
import { addMonths, formatMonth, isMonthKey, monthKey, todayInTimeZone } from "@/lib/dates";
import { BUDGET_KINDS, type BudgetKind } from "@/lib/db/types";
import { suggestedKind } from "@/lib/finance/budgets";
import { loadBudget } from "@/lib/finance/load-budget";
import { parseView, viewLabel, viewParam } from "@/lib/finance/view-param";
import { formatCentsRounded } from "@/lib/money";
import { firstParam, queryString } from "@/lib/params";

export const metadata: Metadata = { title: "Budget" };

export default async function BudgetPage({ searchParams }: PageProps<"/budget">) {
  const session = await requireHousehold();
  const params = await searchParams;
  const currentMonth = monthKey(todayInTimeZone(HOUSEHOLD_TIME_ZONE));
  const requested = firstParam(params.month) ?? "";
  // Budgets can be planned up to a year ahead.
  const month = isMonthKey(requested) && requested <= addMonths(currentMonth, 12) ? requested : currentMonth;
  const view = parseView(firstParam(params.view), session.members);
  const viewValue = view.kind === "everyone" ? undefined : viewParam(view);

  const budget = await loadBudget(session, view, month);
  const names = new Map(budget.categories.map((category) => [category.id, category.name]));
  const memberNames = new Map(session.members.map((member) => [member.id, member.name]));

  const rows: BudgetRowView[] = budget.progress.map(({ line, budgetCents, spentCents, remainingCents, fund }) => ({
    id: line.id,
    label: line.subcategory_id
      ? `${names.get(line.category_id) ?? ""} › ${names.get(line.subcategory_id) ?? ""}`
      : (names.get(line.category_id) ?? ""),
    owner:
      view.kind !== "everyone" || line.scope === "everyone"
        ? null
        : line.scope === "shared"
          ? "Shared"
          : (memberNames.get(line.person_id ?? "") ?? null),
    kind: line.kind,
    amount: line.amount,
    budgetCents,
    spentCents,
    remainingCents,
    fund,
  }));
  const groups = BUDGET_KINDS.map((kind) => ({ kind, rows: rows.filter((row) => row.kind === kind) })).filter(
    (group) => group.rows.length > 0,
  );

  const kinds: Record<string, BudgetKind> = {};
  for (const category of budget.categories) {
    kinds[category.id] = category.parent_id
      ? suggestedKind(category.parent_id, category.id, budget.categories)
      : suggestedKind(category.id, null, budget.categories);
  }

  const label = viewLabel(view, session.members);
  const monthLink = (target: string) => `/budget${queryString({ month: target === currentMonth ? undefined : target, view: viewValue })}`;
  const scopeHint =
    view.kind === "everyone"
      ? "Added here, a budget covers the whole household. For a personal budget, like play money, switch to that person first."
      : view.kind === "shared"
        ? "Budgets for bills paid from the joint account."
        : `Budgets for ${label}'s own spending.`;

  return (
    <>
      <PageHeader title={`Budget · ${formatMonth(month)}`} subtitle={`${label} · ${session.household.name}`}>
        <Stepper
          label={formatMonth(month)}
          previousHref={monthLink(addMonths(month, -1))}
          nextHref={month < addMonths(currentMonth, 12) ? monthLink(addMonths(month, 1)) : null}
        />
      </PageHeader>

      <ViewSwitcher
        path="/budget"
        current={view}
        members={session.members}
        params={{ month: month === currentMonth ? undefined : month }}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Budgeted" value={formatCentsRounded(budget.totals.budgetCents)} hint="this month" />
        <Metric label="Spent" value={formatCentsRounded(budget.totals.spentCents)} hint="in budgeted categories" />
        <Metric
          label="Left to spend"
          value={formatCentsRounded(budget.totals.flexibleRemainingCents)}
          hint="everyday spending and allowances"
        />
        <Metric label="Not in a budget" value={formatCentsRounded(budget.unbudgetedCents)} hint="spent this month" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-start">
        {groups.length > 0 ? (
          <BudgetGroups groups={groups} month={month} readOnly={session.isDemo} />
        ) : (
          <Card>
            <p className="text-sm font-medium">No budget for {label === "Everyone" ? "the household" : label} yet.</p>
            <p className="mt-1 text-sm text-muted">
              Add one category at a time, or let the app suggest budgets from your recent spending.
            </p>
          </Card>
        )}
        {!session.isDemo && (
          <AddBudget
            view={viewParam(view)}
            month={month}
            groups={categoryGroups(budget.categories)}
            averages={budget.averages}
            kinds={kinds}
            averageMonths={budget.averageMonths}
            scopeHint={scopeHint}
          />
        )}
      </div>
    </>
  );
}
