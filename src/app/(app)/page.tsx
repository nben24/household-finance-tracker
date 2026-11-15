import type { Metadata } from "next";
import Link from "next/link";
import { coverageHeadline } from "@/components/coverage-card";
import { FirstSteps } from "@/components/first-steps";
import { OtherAlert } from "@/components/other-alert";
import { primaryButton, secondaryButton } from "@/components/styles";
import { TransactionList, buildLookups } from "@/components/transaction-list";
import { BarList, Card, Metric, SegmentedLinks, Stepper, TextLink } from "@/components/ui";
import { ViewSwitcher } from "@/components/view-switcher";
import { SHARED_SPENDING_MODE, WEEK_STARTS_ON } from "@/lib/config";
import { earliestTransactionDate, getDataSource, requireHousehold, reviewQueueFilter } from "@/lib/data";
import { formatDay, formatShortMonth, monthKey } from "@/lib/dates";
import { budgetStatus } from "@/lib/finance/budgets";
import { spendingPace } from "@/lib/finance/charts";
import { loadBudget } from "@/lib/finance/load-budget";
import { loadCoverage } from "@/lib/finance/load-coverage";
import { loadForecast } from "@/lib/finance/load-forecast";
import { activeItems, loadRecurring } from "@/lib/finance/load-recurring";
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
import { upcoming } from "@/lib/finance/recurring";
import { spendingByPerson } from "@/lib/finance/summary";
import { viewOptions } from "@/lib/finance/view-options";
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
import { householdToday } from "@/lib/household-time";
import { formatCents, formatCentsRounded, formatEffectRounded } from "@/lib/money";
import { firstParam, queryString } from "@/lib/params";

export const metadata: Metadata = { title: "Home" };

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

  const today = householdToday(session.household);
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

  const [accounts, categories, history, review, dataStartsOn, budget, recurring, coverage] = await Promise.all([
    data.listAccounts(householdId),
    data.listCategories(householdId),
    data.listTransactions(householdId, { from: trendPeriods[0].from, to: period.to }),
    data.listTransactions(householdId, reviewQueueFilter(session.household), { limit: 1, offset: 0 }),
    earliestTransactionDate(householdId),
    loadBudget(session, view, budgetMonth),
    loadRecurring(session, view),
    loadCoverage(householdId),
  ]);
  const comingUp = upcoming(activeItems(recurring.items), today, 14).slice(0, 6);

  const entries = viewEntries(history.rows, view, viewOptions(session));
  const periodEntries = entries.filter((entry) => containsDate(period, entry.date));
  const totals = viewTotals(periodEntries, view);
  const byCategory = entriesByCategory(periodEntries, categories);
  // "Usual" only uses periods every account's activity fully covers.
  const usualPeriods = earlierPeriods(period, USUAL_COUNT[unit], WEEK_STARTS_ON).filter((earlier) =>
    coverage.isRangeComplete(earlier.from, earlier.to),
  );
  const usual = typicalByCategory(entries, categories, usualPeriods);
  const projection =
    unit === "month" && isCurrent ? (await loadForecast(session, view, period.key)).forecast.spending : null;
  const trend = trendPeriods.map((trendPeriod) => ({
    period: trendPeriod,
    cents: spendingInRange(entries, trendPeriod.from, trendPeriod.to),
  }));

  // Spending so far compared with a typical period at the same point.
  let comparison: string | undefined;
  if (unit === "month") {
    const pace = spendingPace(entries, period.key, today, coverage.isMonthComplete);
    const day = isCurrent ? pace.throughDay : pace.daysInMonth;
    const typical = pace.typical && day > 0 ? pace.typical[day - 1] : null;
    if (typical !== null) {
      const difference = totals.spendingCents - typical;
      comparison =
        Math.abs(difference) < Math.max(2000, typical * 0.05)
          ? `about the same as a typical month ${isCurrent ? "by now" : ""}`.trim()
          : `${formatCentsRounded(Math.abs(difference))} ${difference > 0 ? "more" : "less"} than a typical month${isCurrent ? " by now" : ""}`;
    }
  } else if (usualPeriods.length > 0) {
    const weeks = usualPeriods.map((week) => spendingInRange(entries, week.from, week.to)).sort((a, b) => a - b);
    const typical = weeks[Math.floor(weeks.length / 2)];
    comparison = `typical week: ${formatCentsRounded(typical)}`;
  }

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
  const budgetLink = `/budget${queryString({ month: budgetMonth === monthKey(today) ? undefined : budgetMonth, view: viewValue })}`;
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "";

  // Budget lines that need attention: over budget first, then nearly used up.
  const statuses = budget.progress
    .filter((p) => p.line.kind !== "sinking_fund" && p.budgetCents > 0)
    .map((p) => ({ p, status: budgetStatus(p, formatCentsRounded) }));
  const exceptions = statuses
    .filter(({ p, status }) => status.over || (p.line.kind !== "fixed" && p.spentCents / p.budgetCents >= 0.85))
    .sort((a, b) => b.p.spentCents / b.p.budgetCents - a.p.spentCents / a.p.budgetCents)
    .slice(0, 5);

  const pendingCents = periodEntries
    .filter((entry) => entry.kind === "contribution" && entry.pending)
    .reduce((total, entry) => total + entry.cents, 0);
  const supporting: { label: string; value: string; hint?: string }[] = [
    { label: "Income", value: formatCentsRounded(totals.incomeCents) },
    {
      label: "Saved & invested",
      value: formatCentsRounded(totals.savedCents + totals.investedCents),
      hint: `${formatCentsRounded(totals.savedCents)} to savings · ${formatCentsRounded(totals.investedCents)} invested`,
    },
  ];
  if (view.kind === "person" && SHARED_SPENDING_MODE === "separate") {
    supporting.push({
      label: "Paid into shared",
      value: formatCentsRounded(totals.contributionCents),
      hint:
        pendingCents > 0
          ? `incl. ${formatCentsRounded(pendingCents)} not on the joint account's statement yet`
          : "as shown on the joint account's own activity",
    });
  }
  if (view.kind === "shared") {
    supporting.push({ label: "Paid in by both of you", value: formatCentsRounded(totals.contributionCents) });
  }
  supporting.push({
    label: "Cash left over",
    value: formatEffectRounded(totals.netCents),
    hint: `income minus spending, ${view.kind === "person" && SHARED_SPENDING_MODE === "separate" ? "paid into shared, " : ""}savings and investing — not a budget`,
  });

  const hasData = dataStartsOn !== null;
  const showFirstSteps = !session.isDemo && (!hasData || session.household.review_starts_on === null);

  return (
    <>
      {/* 1. Where you are: the period and whose money, compact. */}
      <header className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">{periodLabel(period)}</h1>
            <p className="break-anywhere text-sm text-muted">
              {viewLabel(view, session.members)} · {session.household.name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedLinks
              label="Month or week"
              options={[
                { href: `/${queryString({ view: viewValue })}`, label: "Month", selected: unit === "month" },
                { href: `/${queryString({ period: "week", view: viewValue })}`, label: "Week", selected: unit === "week" },
              ]}
            />
            <Stepper
              label={periodLabel(period)}
              previousHref={periodLink(shiftPeriod(period, -1, WEEK_STARTS_ON))}
              nextHref={next.from <= today ? periodLink(next) : null}
            />
          </div>
        </div>
        <div className="mt-3">
          <ViewSwitcher path="/" current={view} members={session.members} params={periodQuery(period, today)} compact />
        </div>
      </header>

      {showFirstSteps && (
        <FirstSteps hasData={hasData} reviewStartsOn={session.household.review_starts_on} waiting={review.total} />
      )}

      {/* 2. What needs doing. */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <div
          className={`flex flex-1 flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm ${
            review.total > 0 ? "bg-notice-soft text-notice" : "border border-line bg-surface"
          }`}
        >
          <span className="font-medium">
            {review.total > 0
              ? `${review.total} ${review.total === 1 ? "transaction needs" : "transactions need"} a decision`
              : hasData
                ? "Nothing waiting for a decision"
                : "No activity imported yet"}
          </span>
          {review.total > 0 ? (
            <Link href={`/review${queryString({ view: viewValue })}`} className={primaryButton}>
              Review now
            </Link>
          ) : null}
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <span className={coverage.summary.upToDate < coverage.summary.total ? "text-notice" : "text-muted"}>
            {coverageHeadline(coverage.summary)}
          </span>
          <Link href="/import" className={secondaryButton}>
            Import
          </Link>
        </div>
      </div>

      {view.kind === "everyone" && unit === "month" && (
        <OtherAlert transactions={periodRows} categories={categories} month={period.key} />
      )}

      {/* 3. The headline: spending, and the everyday budget left. */}
      <Card className="mb-4">
        <div className="grid gap-5 sm:grid-cols-2">
          <Metric
            size="primary"
            label={isCurrent ? `Spent so far this ${unitWord}` : `Spent in ${periodShortLabel(period)}`}
            value={formatCentsRounded(totals.spendingCents)}
            hint={
              <>
                {comparison}
                {projection && (
                  <>
                    {comparison && " · "}
                    <Link href={`/forecast${queryString({ view: viewValue })}`} className="hover:underline">
                      heading for about {formatCentsRounded(projection.expectedCents)}
                    </Link>
                  </>
                )}
              </>
            }
          />
          {budget.progress.length > 0 ? (
            <Metric
              size="secondary"
              label={`Everyday budget left${unit === "week" ? ` · ${formatShortMonth(budgetMonth)}` : ""}`}
              value={formatEffectRounded(budget.totals.flexibleRemainingCents).replace("+", "")}
              tone={budget.totals.flexibleRemainingCents < 0 ? "notice" : undefined}
              hint="what's left in everyday and allowance budgets this month — bills and saving-up funds aren't included"
            />
          ) : (
            <div>
              <p className="text-sm font-medium text-muted">Everyday budget</p>
              <p className="mt-1 text-sm">
                No budget for {view.kind === "everyone" ? "the household" : viewLabel(view, session.members)} yet.{" "}
                <TextLink href={budgetLink}>Set one up</TextLink>
              </p>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-start">
        <div className="flex flex-col gap-4">
          {/* 4. Budget exceptions. */}
          {budget.progress.length > 0 && (
            <Card title={unit === "week" ? `Budget · ${formatShortMonth(budgetMonth)}` : "Budget"} action={<TextLink href={budgetLink}>Open budget</TextLink>}>
              <p className={`mb-3 text-sm ${exceptions.some((e) => e.status.over) ? "text-notice" : "text-muted"}`}>
                {exceptions.length === 0
                  ? `All ${statuses.length} ${statuses.length === 1 ? "budget is" : "budgets are"} within budget so far.`
                  : `${exceptions.filter((e) => e.status.over).length} over budget · ${exceptions.filter((e) => !e.status.over).length} nearly used up · ${statuses.length - exceptions.length} on track`}
              </p>
              <BarList
                empty=""
                items={(exceptions.length > 0
                  ? exceptions
                  : [...statuses].sort((a, b) => b.p.spentCents / b.p.budgetCents - a.p.spentCents / a.p.budgetCents).slice(0, 3)
                ).map(({ p, status }) => ({
                  key: p.line.id,
                  label: `${categoryName(p.line.subcategory_id ?? p.line.category_id)}${
                    view.kind === "everyone" && p.line.scope === "person"
                      ? ` · ${session.members.find((m) => m.id === p.line.person_id)?.name ?? ""}`
                      : ""
                  }`,
                  value: `${formatCentsRounded(p.spentCents)} of ${formatCentsRounded(p.budgetCents)}`,
                  fraction: status.fraction,
                  tone: status.tone,
                  note: status.over ? `▲ ${status.text}` : p.spentCents / p.budgetCents >= 0.85 && p.line.kind !== "fixed" ? "nearly used up" : status.text,
                  status: status.text,
                }))}
              />
            </Card>
          )}

          {/* 6. Where the money went. */}
          <Card title="Where the money went">
            <BarList
              empty={hasData ? `No spending recorded for this ${unitWord} yet.` : "Nothing imported yet."}
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
            {!hasData && (
              <Link href="/import" className={`mt-3 ${primaryButton}`}>
                Import bank activity
              </Link>
            )}
            {usualPeriods.length > 0 && (
              <p className="mt-4 text-[13px] text-muted">
                “Usual” is the typical {unitWord} of the previous{" "}
                {usualPeriods.length === 1 ? unitWord : `${usualPeriods.length} ${unitWord}s`} with every account imported
                (the middle one, so a single big purchase doesn&apos;t skew it).
              </p>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {/* 5. Coming up. */}
          <Card title="Coming up" action={<TextLink href={`/recurring${queryString({ view: viewValue })}`}>Recurring</TextLink>}>
            {comingUp.length === 0 ? (
              <p className="text-sm text-muted">No regular bills or income expected in the next two weeks.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {comingUp.map(({ item, date }) => (
                  <li key={`${item.key}-${date}`} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 break-anywhere">
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

          {/* 7. Supporting figures. */}
          <Card title={`The ${unitWord} in figures`}>
            <div className="grid grid-cols-2 gap-4">
              {supporting.map((metric) => (
                <Metric key={metric.label} size="supporting" {...metric} />
              ))}
            </div>
          </Card>

          {view.kind === "everyone" && byPerson.length > 0 && (
            <Card title="Who spent it">
              <BarList
                empty=""
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
            <Card title="Paid in by both of you">
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
                note: containsDate(entry.period, today) ? "so far" : coverage.isRangeComplete(entry.period.from, entry.period.to) ? undefined : "partial data",
              }))}
            />
          </Card>
        </div>
      </div>

      <Card className="mt-4" title="Latest transactions" action={<TextLink href={transactionsLink({})}>See all</TextLink>}>
        <TransactionList today={today} transactions={recent} lookups={lookups} empty={`Nothing yet for this ${unitWord}.`} />
      </Card>

      <p className="mt-4 text-[13px] text-muted">{viewDescription(view)}</p>
    </>
  );
}
