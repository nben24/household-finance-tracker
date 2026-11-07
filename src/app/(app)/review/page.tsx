import type { Metadata } from "next";
import { OtherAlert } from "@/components/other-alert";
import { ManualEntryActions } from "@/components/manual/manual-entry-actions";
import { ReviewQueue } from "@/components/review/review-card";
import { BarList, Card, Metric, PageHeader, Stepper, TextLink } from "@/components/ui";
import { ViewSwitcher } from "@/components/view-switcher";
import { categoryGroups, frequentSubcategories, toReviewItem } from "@/lib/categories/view";
import { HOUSEHOLD_TIME_ZONE, SHARED_SPENDING_MODE, WEEK_STARTS_ON } from "@/lib/config";
import { catchUpFilter, getDataSource, requireHousehold, reviewQueueFilter } from "@/lib/data";
import {
  addDays,
  formatDay,
  formatDayWithYear,
  isISODate,
  monthKey,
  monthRange,
  todayInTimeZone,
  weekRange,
} from "@/lib/dates";
import { activeItems, loadRecurring } from "@/lib/finance/load-recurring";
import { spendingByPerson } from "@/lib/finance/summary";
import { parseView, viewLabel, viewParam, viewPersonFilter } from "@/lib/finance/view-param";
import { entriesByCategory, viewEntries, viewTotals } from "@/lib/finance/views";
import { STILL_WAITING_AFTER_DAYS } from "@/lib/import/manual";
import { formatCents, formatSignedAmount } from "@/lib/money";
import { firstParam, queryString } from "@/lib/params";

export const metadata: Metadata = { title: "Sunday Review" };

const QUEUE_LIMIT = 50;

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const session = await requireHousehold();
  const householdId = session.household.id;
  const data = getDataSource();

  const today = todayInTimeZone(HOUSEHOLD_TIME_ZONE);
  const currentWeek = weekRange(today, WEEK_STARTS_ON);
  // Open on the week that includes yesterday, so on the first day of a new
  // week the review shows the full week that just ended.
  const defaultWeek = weekRange(addDays(today, -1), WEEK_STARTS_ON);
  const params = await searchParams;
  const requested = firstParam(params.week) ?? "";
  const view = parseView(firstParam(params.view), session.members);
  const viewValue = view.kind === "everyone" ? undefined : viewParam(view);
  const personFilter = viewPersonFilter(view);
  const week =
    isISODate(requested) && requested <= today ? weekRange(requested, WEEK_STARTS_ON) : defaultWeek;
  const month = monthKey(today);

  const catchUp = catchUpFilter(session.household);
  const [accounts, categories, rules, weekTransactions, queue, thisMonth, recent, catchUpWaiting, awaiting, recurring] = await Promise.all([
    data.listAccounts(householdId),
    data.listCategories(householdId),
    data.listRules(householdId),
    data.listTransactions(householdId, week),
    data.listTransactions(householdId, reviewQueueFilter(session.household, { personId: personFilter }), {
      limit: QUEUE_LIMIT,
      offset: 0,
    }),
    data.listTransactions(householdId, monthRange(month)),
    data.listTransactions(householdId, { from: addDays(today, -90) }),
    catchUp ? data.listTransactions(householdId, catchUp, { limit: 1, offset: 0 }) : Promise.resolve({ rows: [], total: 0 }),
    data.listTransactions(householdId, { awaitingPost: true, to: addDays(today, -STILL_WAITING_AFTER_DAYS) }),
    loadRecurring(session, view),
  ]);
  // New recurring charges, or price changes, seen since the start of this week.
  const recurringNews = activeItems(recurring.items).filter(
    (item) =>
      item.kind === "charge" &&
      ((item.isNew && item.lastDate >= week.from) || (item.priceChange !== null && item.priceChange.date >= week.from)),
  );

  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const membersById = new Map(session.members.map((member) => [member.id, member]));
  const items = queue.rows.map((row) => toReviewItem(row, accountsById, membersById, rules, today));
  const groups = categoryGroups(categories, items.map((item) => item.subcategoryId));
  const quickPicks = frequentSubcategories(recent.rows);

  // This week, as seen from the chosen view.
  const weekRows = weekTransactions.rows.filter((row) =>
    view.kind === "everyone" ? true : view.kind === "shared" ? row.person_id === null : row.person_id === view.personId,
  );
  const entries = viewEntries(weekTransactions.rows, view, {
    memberCount: session.members.length,
    mode: SHARED_SPENDING_MODE,
  });
  const spentCents = viewTotals(entries, view).spendingCents;
  const waitingThisWeek = weekRows.filter((row) => row.review_status === "needs_review").length;
  const byCategory = entriesByCategory(entries, categories);
  const byPerson = view.kind === "everyone" ? spendingByPerson(weekTransactions.rows, session.members) : [];
  const largest = Math.max(1, ...byCategory.map((group) => group.cents));
  const weekLabel = `${formatDay(week.from)} – ${formatDayWithYear(week.to)}`;
  const done = queue.total === 0;

  return (
    <>
      <PageHeader title="Sunday Review" subtitle={`Week of ${weekLabel}`}>
        <TextLink href="/transactions/new">+ Add a transaction</TextLink>
        <Stepper
          label={weekLabel}
          previousHref={`/review${queryString({ week: addDays(week.from, -7), view: viewValue })}`}
          nextHref={
            week.from < currentWeek.from ? `/review${queryString({ week: addDays(week.from, 7), view: viewValue })}` : null
          }
        />
      </PageHeader>

      <ViewSwitcher path="/review" current={view} members={session.members} params={{ week: requested || undefined }} />

      <OtherAlert transactions={thisMonth.rows} categories={categories} month={month} />

      {recurringNews.length > 0 && (
        <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          {recurringNews.length} new recurring {recurringNews.length === 1 ? "charge or price change" : "charges or price changes"}{" "}
          this week: {recurringNews.map((item) => item.merchant).join(", ")}.{" "}
          <TextLink href={`/recurring${queryString({ view: viewValue })}`}>Open Recurring</TextLink>
        </p>
      )}

      {awaiting.rows.length > 0 && (
        <Card className="mb-4" title="Still waiting to post">
          <p className="mb-3 text-xs text-muted">
            You added these by hand, but no matching charge has shown up in a bank download after{" "}
            {STILL_WAITING_AFTER_DAYS} days. Delete any that didn&apos;t happen, or keep ones that won&apos;t post (like cash).
          </p>
          <ul className="divide-y divide-line">
            {awaiting.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{row.normalized_merchant}</span>{" "}
                  <span className="text-muted">
                    {formatSignedAmount(row.amount)} on {formatDayWithYear(row.transaction_date)}
                  </span>
                </span>
                <ManualEntryActions id={row.id} awaitingPost />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {catchUpWaiting.total > 0 && (
        <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          {catchUpWaiting.total} older {catchUpWaiting.total === 1 ? "transaction is" : "transactions are"} waiting in
          Catch-up, sorted by merchant.{" "}
          <TextLink href="/catch-up">Open Catch-up</TextLink>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Transactions" value={String(weekRows.length)} hint="in this week" />
        <Metric label="Sorted for you" value={String(weekRows.length - waitingThisWeek)} hint="no action needed" />
        <Metric
          label="To review"
          value={String(queue.total)}
          hint={view.kind === "everyone" ? "waiting for a decision" : `waiting, ${viewLabel(view, session.members)}`}
        />
        <Metric label="Spent in this week" value={formatCents(spentCents)} />
      </div>

      {done ? (
        <Card className="mt-4">
          <p className="text-lg font-semibold">✓ Sunday Review complete</p>
          <p className="mt-1 text-sm text-muted">
            {formatCents(spentCents)} spent in the week of {weekLabel}.
          </p>
        </Card>
      ) : (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold">
            Waiting for a decision
            {queue.total > items.length && (
              <span className="ml-2 font-normal text-muted">
                showing {items.length} of {queue.total}
              </span>
            )}
          </h2>
          <ReviewQueue items={items} groups={groups} quickPicks={quickPicks} />
        </section>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card
          title="The week by category"
          action={
            <TextLink href={`/transactions${queryString({ week: week.from, person: personFilter })}`}>
              See this week&apos;s transactions
            </TextLink>
          }
        >
          <BarList
            empty="No spending recorded in this week."
            items={byCategory.map((group) => ({
              key: group.id ?? "none",
              label: group.name,
              value: formatCents(group.cents),
              fraction: group.cents / largest,
            }))}
          />
        </Card>
        {view.kind === "everyone" && (
          <Card title="The week by person">
            <BarList
              empty="No spending recorded in this week."
              items={byPerson.map((group) => ({
                key: group.id ?? "shared",
                label: group.name,
                value: formatCents(group.cents),
                fraction: group.cents / Math.max(1, ...byPerson.map((entry) => entry.cents)),
              }))}
            />
          </Card>
        )}
      </div>
    </>
  );
}
