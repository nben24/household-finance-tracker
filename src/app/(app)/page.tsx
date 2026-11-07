import type { Metadata } from "next";
import Link from "next/link";
import { OtherAlert } from "@/components/other-alert";
import { TransactionList, buildLookups } from "@/components/transaction-list";
import { BarList, Card, Metric, PageHeader, Stepper, TextLink } from "@/components/ui";
import { ViewSwitcher } from "@/components/view-switcher";
import { HOUSEHOLD_TIME_ZONE, SHARED_SPENDING_MODE, WEEK_STARTS_ON } from "@/lib/config";
import { earliestTransactionDate, getDataSource, requireHousehold, reviewQueueFilter } from "@/lib/data";
import { formatDay, formatShortMonth, monthKey, todayInTimeZone } from "@/lib/dates";
import { loadBudget } from "@/lib/finance/load-budget";
import { loadForecast } from "@/lib/finance/load-forecast";
import { activeItems, loadRecurring } from "@/lib/finance/load-recurring";
import { upcoming } from "@/lib/finance/recurring";
import {
  containsDate,
  earlierPeriods,
  parsePeriod,
  periodLabel,
  periodQuery,
  periodShortLabel,
  shiftPeriod,
  type Period,
} from "@/lib/finance/period";
import { spendingByPerson } from "@/lib/finance/summary";
import { parseView, viewLabel, viewParam, viewPersonFilter } from "@/lib/finance/view-param";
import {
  PAYBACK_GROUP,
  contributionsByPerson,
  entriesByCategory,
  spendingInRange,
  typicalByCategory,
  viewEntries,
  viewTotals,
  type View,
} from "@/lib/finance/views";
import { formatCents, formatCentsRounded } from "@/lib/money";
import { firstParam, queryString } from "@/lib/params";

export const metadata: Metadata = { title: "Dashboard" };

const TREND_COUNT = { month: 6, week: 8 };
const USUAL_COUNT = { month: 3, week: 4 };
const RECENT_COUNT = 6;

function changeNote(cents: number, usual: number | undefined): string | undefined {
  if (usual === undefined || usual === 0) return undefined;
  const difference = cents - usual;
  if (Math.abs(difference) < Math.max(1000, usual * 0.1)) return "about usual";
  return `${difference > 0 ? "+" : "−"}${formatCentsRounded(Math.abs(difference))} vs usual`;
}

function viewDescription(view: View): string {
  if (view.kind === "everyone") {
    return "All household spending. Transfers between your accounts, card payments and paybacks between you are not counted.";
  }
  if (view.kind === "shared") {
    return "Spending from the joint account, and what each of you paid into it.";
  }
  return SHARED_SPENDING_MODE === "split"
    ? "What this person paid, after paybacks between you, plus an equal share of shared spending."
    : "What this person paid, after paybacks between you. Shared bills are under Shared; what this person paid into the shared account is shown separately.";
}

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const session = await requireHousehold();
  const householdId = session.household.id;
  const data = getDataSource();
  const params = await searchParams;

  const today = todayInTimeZone(HOUSEHOLD_TIME_ZONE);
  const period = parsePeriod(
    { period: firstParam(params.period), month: firstParam(params.month), week: firstParam(params.week) },
    today,
    WEEK_STARTS_ON,
  );
  const unit = period.kind;
  const isCurrent = containsDate(period, today);
  const view = parseView(firstParam(params.view), session.members);
  const viewValue = view.kind === "everyone" ? undefined : viewParam(view);
  const trendPeriods = [...earlierPeriods(period, TREND_COUNT[unit] - 1, WEEK_STARTS_ON), period];
  // Budgets are monthly; a week shows the budget of the month it ends in.
  const budgetMonth = monthKey(period.to > today ? today : period.to);

  const [accounts, categories, history, review, dataStartsOn, budget, recurring] = await Promise.all([
    data.listAccounts(householdId),
    data.listCategories(householdId),
    data.listTransactions(householdId, { from: trendPeriods[0].from, to: period.to }),
    data.listTransactions(householdId, reviewQueueFilter(session.household), { limit: 1, offset: 0 }),
    earliestTransactionDate(householdId),
    loadBudget(session, view, budgetMonth),
    loadRecurring(session, view),
  ]);
  const comingUp = upcoming(activeItems(recurring.items), today, 14).slice(0, 6);

  const options = { memberCount: session.members.length, mode: SHARED_SPENDING_MODE };
  const entries = viewEntries(history.rows, view, options);
  const periodEntries = entries.filter((entry) => containsDate(period, entry.date));
  const totals = viewTotals(periodEntries, view);
  const byCategory = entriesByCategory(periodEntries, categories);
  // "Usual" only uses periods the household's data fully covers.
  const usualPeriods = earlierPeriods(period, USUAL_COUNT[unit], WEEK_STARTS_ON).filter(
    (earlier) => dataStartsOn !== null && dataStartsOn <= earlier.from,
  );
  const usual = typicalByCategory(entries, categories, usualPeriods);
  const projection =
    unit === "month" && isCurrent ? (await loadForecast(session, view, period.key)).forecast.spending.expectedCents : null;
  const trend = trendPeriods.map((trendPeriod) => ({
    period: trendPeriod,
    cents: spendingInRange(entries, trendPeriod.from, trendPeriod.to),
  }));

  const periodRows = history.rows.filter((row) => containsDate(period, row.transaction_date));
  const byPerson = view.kind === "everyone" ? spendingByPerson(periodRows, session.members) : [];
  const contributions = contributionsByPerson(periodEntries);
  const personFilter = viewPersonFilter(view);
  const recent = periodRows
    .filter((row) =>
      view.kind === "everyone" ? true : view.kind === "shared" ? row.person_id === null : row.person_id === view.personId,
    )
    .slice(0, RECENT_COUNT);
  const lookups = buildLookups(accounts, categories, session.members);

  const largest = (values: number[]) => Math.max(1, ...values);
  const periodLink = (target: Period) => `/${queryString({ ...periodQuery(target, today), view: viewValue })}`;
  const transactionsRange = unit === "week" ? { week: period.key } : { month: period.key };
  const transactionsLink = (extra: Record<string, string | number | undefined>) =>
    `/transactions${queryString({ ...transactionsRange, person: personFilter, ...extra })}`;
  const next = shiftPeriod(period, 1, WEEK_STARTS_ON);
  const unitWord = unit === "week" ? "week" : "month";

  const pendingCents = periodEntries
    .filter((entry) => entry.kind === "contribution" && entry.pending)
    .reduce((total, entry) => total + entry.cents, 0);
  const metrics: { label: string; value: string; hint?: string }[] = [
    { label: "Income", value: formatCentsRounded(totals.incomeCents) },
    { label: "Spending", value: formatCentsRounded(totals.spendingCents) },
  ];
  if (view.kind === "person" && SHARED_SPENDING_MODE === "separate") {
    metrics.push({
      label: "Paid into shared",
      value: formatCentsRounded(totals.contributionCents),
      hint: pendingCents > 0
        ? `incl. ${formatCentsRounded(pendingCents)} not on the joint account's statement yet`
        : "as shown on the joint account's own activity",
    });
  }
  if (view.kind === "shared") {
    metrics.push({ label: "Paid in", value: formatCentsRounded(totals.contributionCents), hint: "by both of you" });
  }
  metrics.push({
    label: "Saved & invested",
    value: formatCentsRounded(totals.savedCents + totals.investedCents),
    hint: `${formatCentsRounded(totals.savedCents)} to savings · ${formatCentsRounded(totals.investedCents)} invested`,
  });
  metrics.push({
    label: "Left over",
    value: formatCentsRounded(totals.netCents),
    hint:
      view.kind === "person" && SHARED_SPENDING_MODE === "separate"
        ? "after spending, shared, savings and investing"
        : view.kind === "shared"
          ? "paid in + income, after spending and savings"
          : "after spending, savings and investing",
  });
  metrics.push(
    projection !== null
      ? { label: "Projected", value: formatCentsRounded(projection), hint: "spending by month end · see Forecast" }
      : { label: "To review", value: String(review.total), hint: "waiting in Sunday Review" },
  );

  const toggleClass = (selected: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${selected ? "bg-accent-soft text-accent" : "text-muted hover:text-text"}`;

  return (
    <>
      <PageHeader title={periodLabel(period)} subtitle={`${viewLabel(view, session.members)} · ${session.household.name}`}>
        <div className="flex items-center gap-3">
          <nav aria-label="Month or week" className="flex rounded-xl border border-line bg-surface p-1">
            <Link href={`/${queryString({ view: viewValue })}`} className={toggleClass(unit === "month")}>
              Month
            </Link>
            <Link href={`/${queryString({ period: "week", view: viewValue })}`} className={toggleClass(unit === "week")}>
              Week
            </Link>
          </nav>
          <Stepper
            label={periodLabel(period)}
            previousHref={periodLink(shiftPeriod(period, -1, WEEK_STARTS_ON))}
            nextHref={next.from <= today ? periodLink(next) : null}
          />
        </div>
      </PageHeader>

      <ViewSwitcher path="/" current={view} members={session.members} params={periodQuery(period, today)} />

      {view.kind === "everyone" && unit === "month" && (
        <OtherAlert transactions={periodRows} categories={categories} month={period.key} />
      )}

      <div className={`grid grid-cols-2 gap-3 ${metrics.length === 6 ? "sm:grid-cols-3" : "lg:grid-cols-5"}`}>
        {metrics.map((metric) => (
          <Metric key={metric.label} {...metric} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Where the money went">
          <BarList
            empty={`No spending recorded for this ${unitWord} yet.`}
            items={byCategory.map((group) => ({
              key: group.id ?? "none",
              label: group.name,
              value: formatCents(group.cents),
              fraction: group.cents / largest(byCategory.map((g) => g.cents)),
              note: changeNote(group.cents, usual.get(group.id)),
              href:
                group.id === PAYBACK_GROUP
                  ? undefined
                  : group.id
                    ? transactionsLink({ category: group.id })
                    : transactionsLink({ review: 1 }),
            }))}
          />
          {usualPeriods.length > 0 && (
            <p className="mt-4 text-xs text-muted">
              “Usual” is the typical {unitWord} of the previous{" "}
              {usualPeriods.length === 1 ? unitWord : `${usualPeriods.length} ${unitWord}s`} (the middle one, so a single
              big purchase doesn&apos;t skew it).
            </p>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card
            title={unit === "week" ? `Budget · ${formatShortMonth(budgetMonth)}` : "Budget"}
            action={
              <TextLink href={`/budget${queryString({ month: budgetMonth === monthKey(today) ? undefined : budgetMonth, view: viewValue })}`}>
                Open budget
              </TextLink>
            }
          >
            {budget.progress.length === 0 ? (
              <p className="text-sm text-muted">No budget set for this view yet.</p>
            ) : (
              <>
                <p className="mb-3 text-sm">
                  <span className="font-semibold tabular">{formatCentsRounded(budget.totals.flexibleRemainingCents)}</span>{" "}
                  <span className="text-muted">left to spend this month</span>
                </p>
                <BarList
                  empty=""
                  items={[...budget.progress]
                    .filter((p) => p.line.kind !== "sinking_fund" && p.budgetCents > 0)
                    .sort((a, b) => b.spentCents / b.budgetCents - a.spentCents / a.budgetCents)
                    .slice(0, 5)
                    .map((p) => ({
                      key: p.line.id,
                      label: p.line.subcategory_id
                        ? (categories.find((c) => c.id === p.line.subcategory_id)?.name ?? "")
                        : (categories.find((c) => c.id === p.line.category_id)?.name ?? ""),
                      value: `${formatCentsRounded(p.spentCents)} of ${formatCentsRounded(p.budgetCents)}`,
                      fraction: p.spentCents / p.budgetCents,
                      note: p.remainingCents < 0 ? `${formatCentsRounded(-p.remainingCents)} over` : undefined,
                    }))}
                />
              </>
            )}
          </Card>
          <Card title="Coming up" action={<TextLink href={`/recurring${queryString({ view: viewValue })}`}>Recurring</TextLink>}>
            {comingUp.length === 0 ? (
              <p className="text-sm text-muted">No regular bills or income expected in the next two weeks.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {comingUp.map(({ item, date }) => (
                  <li key={`${item.key}-${date}`} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate">
                      {item.merchant}{" "}
                      <span className="text-xs text-muted">
                        {item.flexibleDay ? "around " : ""}
                        {formatDay(date)}
                      </span>
                    </span>
                    <span className={`shrink-0 tabular ${item.kind === "income" ? "text-accent" : ""}`}>
                      {item.kind === "income" ? "+" : ""}
                      {formatCents(item.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {view.kind === "everyone" && (
            <Card title="Who spent it">
              <BarList
                empty={`No spending recorded for this ${unitWord} yet.`}
                items={byPerson.map((group) => ({
                  key: group.id ?? "shared",
                  label: group.name,
                  value: formatCents(group.cents),
                  fraction: group.cents / largest(byPerson.map((g) => g.cents)),
                  href: `/${queryString({ ...periodQuery(period, today), view: group.id ?? "shared" })}`,
                }))}
              />
            </Card>
          )}
          {view.kind === "shared" && (
            <Card title="Paid into the shared account">
              <BarList
                empty={`Nothing paid in this ${unitWord} yet.`}
                items={session.members.map((member) => ({
                  key: member.id,
                  label: member.name,
                  value: formatCents(contributions.get(member.id) ?? 0),
                  fraction: (contributions.get(member.id) ?? 0) / largest([...contributions.values()]),
                }))}
              />
            </Card>
          )}
          <Card title={`Spending, last ${TREND_COUNT[unit]} ${unitWord}s`}>
            <BarList
              empty=""
              items={trend.map((entry) => ({
                key: entry.period.key,
                label: periodShortLabel(entry.period),
                value: formatCentsRounded(entry.cents),
                fraction: entry.cents / largest(trend.map((t) => t.cents)),
                href: periodLink(entry.period),
                note: containsDate(entry.period, today) ? "so far" : undefined,
              }))}
            />
          </Card>
        </div>
      </div>

      <Card className="mt-4" title="Latest transactions" action={<TextLink href={transactionsLink({})}>See all</TextLink>}>
        <TransactionList transactions={recent} lookups={lookups} empty={`Nothing yet for this ${unitWord}.`} />
      </Card>

      <p className="mt-4 text-xs text-muted">{viewDescription(view)}</p>
    </>
  );
}
