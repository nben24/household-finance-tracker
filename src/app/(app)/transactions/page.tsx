import type { Metadata } from "next";
import Link from "next/link";
import { TransactionList, buildLookups } from "@/components/transaction-list";
import { Card, PageHeader, Stepper } from "@/components/ui";
import { HOUSEHOLD_TIME_ZONE, WEEK_STARTS_ON } from "@/lib/config";
import { getDataSource, requireHousehold } from "@/lib/data";
import { TRANSACTION_SORTS, type TransactionFilter, type TransactionSort } from "@/lib/data/types";
import {
  addDays,
  addMonths,
  formatDay,
  formatDayWithYear,
  formatMonth,
  isISODate,
  isMonthKey,
  monthKey,
  monthRange,
  todayInTimeZone,
  weekRange,
} from "@/lib/dates";
import { firstParam, isUuid, queryString } from "@/lib/params";

export const metadata: Metadata = { title: "Transactions" };

const PAGE_SIZE = 50;
const MONTH_CHOICES = 12;
const WEEK_CHOICES = 8;

const SORT_LABELS: Record<TransactionSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  largest_out: "Biggest money out",
  largest_in: "Biggest money in",
};

const controlClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const session = await requireHousehold();
  const householdId = session.household.id;
  const data = getDataSource();
  const params = await searchParams;

  const today = todayInTimeZone(HOUSEHOLD_TIME_ZONE);
  const currentMonth = monthKey(today);
  // The filter form sends `when` ("all", "2026-09" or "w2026-09-27"); links send `week` or `month`.
  const when = firstParam(params.when);
  const weekParam = when?.startsWith("w") ? when.slice(1) : when ? undefined : firstParam(params.week);
  const monthParam = (when && !when.startsWith("w") ? when : firstParam(params.month)) ?? currentMonth;
  const week = weekParam && isISODate(weekParam) ? weekRange(weekParam, WEEK_STARTS_ON) : null;
  const month = week ? null : monthParam === "all" ? "all" : isMonthKey(monthParam) ? monthParam : currentMonth;
  const categoryId = [firstParam(params.category) ?? ""].find(isUuid);
  const accountId = [firstParam(params.account) ?? ""].find(isUuid);
  const personParam = firstParam(params.person) ?? "";
  const personId = personParam === "household" || isUuid(personParam) ? personParam : undefined;
  const search = (firstParam(params.q) ?? "").trim().slice(0, 80);
  const needsReview = firstParam(params.review) === "1";
  const sort = TRANSACTION_SORTS.find((choice) => choice === firstParam(params.sort)) ?? "newest";
  const pageNumber = Math.max(1, Math.floor(Number(firstParam(params.page))) || 1);

  const filter: TransactionFilter = {
    ...(week ?? (month === "all" || month === null ? {} : monthRange(month))),
    categoryId,
    accountId,
    personId,
    search: search || undefined,
    needsReview,
  };

  const [accounts, categories, result] = await Promise.all([
    data.listAccounts(householdId),
    data.listCategories(householdId),
    data.listTransactions(householdId, filter, {
      limit: PAGE_SIZE,
      offset: (pageNumber - 1) * PAGE_SIZE,
      sort,
    }),
  ]);
  const lookups = buildLookups(accounts, categories, session.members);
  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const monthChoices = Array.from({ length: MONTH_CHOICES }, (_, index) => addMonths(currentMonth, -index));
  if (month && month !== "all" && !monthChoices.includes(month)) monthChoices.push(month);
  const thisWeek = weekRange(today, WEEK_STARTS_ON).from;
  const weekChoices = Array.from({ length: WEEK_CHOICES }, (_, index) => addDays(thisWeek, -7 * index));
  if (week && !weekChoices.includes(week.from)) weekChoices.push(week.from);
  const whenValue = week ? `w${week.from}` : (month ?? "all");

  const filterQuery = (overrides: Record<string, string | number | undefined> = {}) =>
    queryString({
      week: week?.from,
      month: week ? undefined : (month ?? undefined),
      category: categoryId,
      account: accountId,
      person: personId,
      q: search,
      review: needsReview ? 1 : undefined,
      sort: sort === "newest" ? undefined : sort,
      ...overrides,
    });
  const pageHref = (page: number) => `/transactions${filterQuery({ page: page > 1 ? page : undefined })}`;
  const weekHref = (from: string) => `/transactions${filterQuery({ week: from })}`;
  const periodText = week
    ? ` in the week of ${formatDay(week.from)} – ${formatDayWithYear(week.to)}`
    : month === "all" || month === null
      ? ""
      : ` in ${formatMonth(month)}`;


  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={`${result.total.toLocaleString("en-US")} ${result.total === 1 ? "transaction" : "transactions"}${periodText}`}
      >
        <Link
          href="/transactions/new"
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-surface"
        >
          + Add
        </Link>
        {week && (
          <Stepper
            label={`week of ${formatDay(week.from)}`}
            previousHref={weekHref(addDays(week.from, -7))}
            nextHref={week.to < today ? weekHref(addDays(week.from, 7)) : null}
          />
        )}
      </PageHeader>

      <Card className="mb-4">
        <form method="get" className="grid grid-cols-2 gap-3 lg:grid-cols-7">
          <label className="col-span-2 text-xs font-medium text-muted">
            Search
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Merchant or description"
              className={`mt-1 ${controlClass}`}
            />
          </label>
          <label className="text-xs font-medium text-muted">
            When
            <select name="when" defaultValue={whenValue} className={`mt-1 ${controlClass}`}>
              <option value="all">All time</option>
              <optgroup label="Weeks">
                {weekChoices.map((start) => (
                  <option key={start} value={`w${start}`}>
                    {start === thisWeek ? "This week" : `Week of ${formatDay(start)}`}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Months">
                {monthChoices.map((choice) => (
                  <option key={choice} value={choice}>
                    {formatMonth(choice)}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="text-xs font-medium text-muted">
            Category
            <select name="category" defaultValue={categoryId ?? ""} className={`mt-1 ${controlClass}`}>
              <option value="">All categories</option>
              {categories
                .filter((category) => category.parent_id === null)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted">
            Person
            <select name="person" defaultValue={personId ?? ""} className={`mt-1 ${controlClass}`}>
              <option value="">Everyone</option>
              {session.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
              <option value="household">Shared (joint account)</option>
            </select>
          </label>
          <label className="text-xs font-medium text-muted">
            Account
            <select name="account" defaultValue={accountId ?? ""} className={`mt-1 ${controlClass}`}>
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.institution} {account.account_name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted">
            Sort
            <select name="sort" defaultValue={sort} className={`mt-1 ${controlClass}`}>
              {TRANSACTION_SORTS.map((choice) => (
                <option key={choice} value={choice}>
                  {SORT_LABELS[choice]}
                </option>
              ))}
            </select>
          </label>
          <div className="col-span-2 flex flex-wrap items-center justify-between gap-3 lg:col-span-7">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="review" value="1" defaultChecked={needsReview} className="h-4 w-4" />
              Only show what needs review
            </label>
            <div className="flex items-center gap-3">
              <Link href="/transactions" className="text-sm font-medium text-muted hover:text-text">
                Clear
              </Link>
              <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-surface">
                Apply
              </button>
            </div>
          </div>
        </form>
      </Card>

      <Card>
        <TransactionList
          transactions={result.rows}
          lookups={lookups}
          empty="No transactions match these choices."
        />
        {pageCount > 1 && (
          <nav className="mt-4 flex items-center justify-between border-t border-line pt-4 text-sm" aria-label="Pages">
            {pageNumber > 1 ? (
              <Link href={pageHref(pageNumber - 1)} className="font-medium text-accent hover:underline">
                ← {sort === "newest" ? "Newer" : "Previous"}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted">
              Page {Math.min(pageNumber, pageCount)} of {pageCount}
            </span>
            {pageNumber < pageCount ? (
              <Link href={pageHref(pageNumber + 1)} className="font-medium text-accent hover:underline">
                {sort === "newest" ? "Older" : "Next"} →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Card>
    </>
  );
}
