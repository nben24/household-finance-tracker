import type { Metadata } from "next";
import Link from "next/link";
import { OtherAlert } from "@/components/other-alert";
import { ManualEntryActions } from "@/components/manual/manual-entry-actions";
import { ReviewQueue } from "@/components/review/review-card";
import { primaryButton, secondaryButton } from "@/components/styles";
import { BarList, Callout, Card, Metric, PageHeader, SegmentedLinks, Stepper, TextLink } from "@/components/ui";
import { ViewSwitcher } from "@/components/view-switcher";
import { categoryGroups, frequentSubcategories, toReviewItem } from "@/lib/categories/view";
import { WEEK_STARTS_ON } from "@/lib/config";
import { catchUpFilter, getDataSource, requireHousehold, reviewQueueFilter } from "@/lib/data";
import type { TransactionFilter } from "@/lib/data/types";
import { addDays, formatDay, formatDayWithYear, isISODate, monthKey, monthRange, weekRange } from "@/lib/dates";
import { activeItems, loadRecurring } from "@/lib/finance/load-recurring";
import { spendingByPerson } from "@/lib/finance/summary";
import { viewOptions } from "@/lib/finance/view-options";
import { parseView, viewLabel, viewParam, viewPersonFilter } from "@/lib/finance/view-param";
import { entriesByCategory, viewEntries, viewTotals } from "@/lib/finance/views";
import { householdToday } from "@/lib/household-time";
import { STILL_WAITING_AFTER_DAYS } from "@/lib/import/manual";
import { formatCents, formatSignedAmount } from "@/lib/money";
import { firstParam, queryString } from "@/lib/params";

export const metadata: Metadata = { title: "Sunday Review" };

const QUEUE_LIMIT = 50;

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const session = await requireHousehold();
  const householdId = session.household.id;
  const data = getDataSource();

  const today = householdToday(session.household);
  const currentWeek = weekRange(today, WEEK_STARTS_ON);
  // Open on the week that includes yesterday, so on the first day of a new
  // week the review shows the full week that just ended.
  const defaultWeek = weekRange(addDays(today, -1), WEEK_STARTS_ON);
  const params = await searchParams;
  const requested = firstParam(params.week) ?? "";
  const view = parseView(firstParam(params.view), session.members);
  const viewValue = view.kind === "everyone" ? undefined : viewParam(view);
  const personFilter = viewPersonFilter(view);
  const week = isISODate(requested) && requested <= today ? weekRange(requested, WEEK_STARTS_ON) : defaultWeek;
  const weekValue = requested && isISODate(requested) ? week.from : undefined;
  const weekOnly = firstParam(params.scope) === "week";
  const month = monthKey(today);

  // Everything waiting (from when weekly reviews start), or only this week's.
  const allWaiting = reviewQueueFilter(session.household, { personId: personFilter });
  const queueFilter: TransactionFilter = weekOnly
    ? {
        ...allWaiting,
        from: allWaiting.from && allWaiting.from > week.from ? allWaiting.from : week.from,
        to: week.to,
      }
    : allWaiting;

  const catchUp = catchUpFilter(session.household);
  const [accounts, categories, rules, weekTransactions, queue, waitingTotal, thisMonth, recent, catchUpWaiting, awaiting, recurring] =
    await Promise.all([
      data.listAccounts(householdId),
      data.listCategories(householdId),
      data.listRules(householdId),
      data.listTransactions(householdId, week),
      data.listTransactions(householdId, queueFilter, { limit: QUEUE_LIMIT, offset: 0 }),
      weekOnly ? data.listTransactions(householdId, allWaiting, { limit: 1, offset: 0 }) : Promise.resolve(null),
      data.listTransactions(householdId, monthRange(month)),
      data.listTransactions(householdId, { from: addDays(today, -90) }),
      catchUp ? data.listTransactions(householdId, catchUp, { limit: 1, offset: 0 }) : Promise.resolve({ rows: [], total: 0 }),
      data.listTransactions(householdId, { awaitingPost: true, to: addDays(today, -STILL_WAITING_AFTER_DAYS) }),
      loadRecurring(session, view),
    ]);
  const allWaitingCount = waitingTotal?.total ?? queue.total;
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
  const fromThisWeek = queue.rows.filter((row) => row.transaction_date >= week.from && row.transaction_date <= week.to).length;

  // This week, as seen from the chosen view.
  const weekRows = weekTransactions.rows.filter((row) =>
    view.kind === "everyone" ? true : view.kind === "shared" ? row.person_id === null : row.person_id === view.personId,
  );
  const entries = viewEntries(weekTransactions.rows, view, viewOptions(session));
  const spentCents = viewTotals(entries, view).spendingCents;
  const waitingThisWeek = weekRows.filter((row) => row.review_status === "needs_review").length;
  const byCategory = entriesByCategory(entries, categories);
  const byPerson = view.kind === "everyone" ? spendingByPerson(weekTransactions.rows, session.members) : [];
  const largest = Math.max(1, ...byCategory.map((group) => group.cents));
  const weekLabel = `${formatDay(week.from)} – ${formatDayWithYear(week.to)}`;
  const done = queue.total === 0;
  const link = (changes: Record<string, string | undefined>) =>
    `/review${queryString({ week: weekValue, view: viewValue, scope: weekOnly ? "week" : undefined, ...changes })}`;

  return (
    <>
      <PageHeader title="Sunday Review" subtitle={`${viewLabel(view, session.members)} · ${session.household.name}`}>
        <TextLink href="/transactions/new">+ Add a transaction</TextLink>
        <Stepper
          label={`Week of ${weekLabel}`}
          showLabel
          previousHref={link({ week: addDays(week.from, -7) })}
          nextHref={week.from < currentWeek.from ? link({ week: addDays(week.from, 7) }) : null}
        />
      </PageHeader>

      <ViewSwitcher
        path="/review"
        current={view}
        members={session.members}
        params={{ week: weekValue, scope: weekOnly ? "week" : undefined }}
      />

      {catchUpWaiting.total > 0 && (
        <Callout className="mb-4">
          {catchUpWaiting.total} older {catchUpWaiting.total === 1 ? "transaction is" : "transactions are"} waiting in
          Catch-up (history from before weekly reviews start), sorted by merchant.{" "}
          <TextLink href="/catch-up">Open Catch-up</TextLink>
        </Callout>
      )}

      {/* The decisions: everything waiting, however old, unless narrowed to this week. */}
      <section aria-labelledby="waiting-heading" className="mb-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="waiting-heading" className="text-lg font-semibold">
              {weekOnly ? `Waiting decisions from the week of ${weekLabel}` : "All waiting decisions — includes earlier weeks"}
            </h2>
            {!done && (
              <p className="text-[13px] text-muted">
                {weekOnly
                  ? `${queue.total} from this week${allWaitingCount > queue.total ? ` · ${allWaitingCount - queue.total} more from other weeks` : ""}`
                  : `${queue.total} waiting · ${fromThisWeek} from this week, ${queue.total - fromThisWeek} from earlier`}
                {queue.total > items.length && ` · showing the first ${items.length}`}
              </p>
            )}
          </div>
          <SegmentedLinks
            label="Which decisions"
            options={[
              { href: link({ scope: undefined }), label: "All waiting", selected: !weekOnly },
              { href: link({ scope: "week" }), label: "Selected week only", selected: weekOnly },
            ]}
          />
        </div>

        {done ? (
          <Card>
            <p className="text-lg font-semibold">
              <span aria-hidden="true">✓ </span>
              {weekOnly ? "Nothing waiting from this week" : "Sunday Review complete"}
            </p>
            <p className="mt-1 text-sm text-muted">
              {weekOnly && allWaitingCount > 0
                ? `${allWaitingCount} ${allWaitingCount === 1 ? "decision is" : "decisions are"} still waiting from other weeks.`
                : `${formatCents(spentCents)} spent in the week of ${weekLabel}.`}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/${queryString({ view: viewValue })}`} className={primaryButton}>
                Back to dashboard
              </Link>
              {weekOnly && allWaitingCount > 0 && (
                <Link href={link({ scope: undefined })} className={secondaryButton}>
                  See all waiting
                </Link>
              )}
            </div>
          </Card>
        ) : (
          <ReviewQueue items={items} groups={groups} quickPicks={quickPicks} total={queue.total} />
        )}
      </section>

      {awaiting.rows.length > 0 && (
        <Card className="mb-4" title="Still waiting to post">
          <p className="mb-3 text-[13px] text-muted">
            You added these by hand, but no matching charge has shown up in a bank download after{" "}
            {STILL_WAITING_AFTER_DAYS} days. Delete any that didn&apos;t happen, or keep ones that won&apos;t post (like cash).
          </p>
          <ul className="divide-y divide-line">
            {awaiting.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 break-anywhere">
                  <span className="font-medium">{row.is_private ? "Private purchase" : row.normalized_merchant}</span>{" "}
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

      {/* The week itself: what happened, for the chosen view. */}
      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="mb-3 text-lg font-semibold">
          This week&apos;s summary
        </h2>
        <OtherAlert transactions={thisMonth.rows} categories={categories} month={month} />
        {recurringNews.length > 0 && (
          <Callout className="mb-4">
            {recurringNews.length} new recurring {recurringNews.length === 1 ? "charge or price change" : "charges or price changes"}{" "}
            this week: {recurringNews.map((item) => item.merchant).join(", ")}.{" "}
            <TextLink href={`/recurring${queryString({ view: viewValue })}`}>Open Recurring</TextLink>
          </Callout>
        )}
        <Card>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric size="secondary" label="Spent this week" value={formatCents(spentCents)} />
            <Metric size="supporting" label="Transactions" value={String(weekRows.length)} />
            <Metric size="supporting" label="Sorted for you" value={String(weekRows.length - waitingThisWeek)} hint="no action needed" />
            <Metric size="supporting" label="Still waiting" value={String(waitingThisWeek)} hint="from this week" />
          </div>
        </Card>
        <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
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
      </section>
    </>
  );
}
