import type { Metadata } from "next";
import Link from "next/link";
import { CloseMonthButton } from "@/components/close-month-button";
import { CoverageConfirm } from "@/components/coverage-confirm";
import { secondaryButton } from "@/components/styles";
import { BarList, Card, Metric, PageHeader, Stepper, TextLink } from "@/components/ui";
import { getDataSource, requireHousehold } from "@/lib/data";
import { addMonths, formatDayWithYear, formatMonth, isMonthKey, monthKey, monthRange } from "@/lib/dates";
import { budgetStatus } from "@/lib/finance/budgets";
import { gapsIn, importableAccounts, requiredAccounts } from "@/lib/finance/coverage";
import { loadBudget } from "@/lib/finance/load-budget";
import { loadCoverage } from "@/lib/finance/load-coverage";
import { sharedSnapshot } from "@/lib/finance/month-end";
import { activeAccounts, balancesOn, holdsTransactions } from "@/lib/finance/net-worth";
import { viewOptions } from "@/lib/finance/view-options";
import { householdToday } from "@/lib/household-time";
import { formatCentsRounded, formatEffectRounded } from "@/lib/money";
import { firstParam, queryString } from "@/lib/params";

export const metadata: Metadata = { title: "Month-end review" };

function Step({ number, title, done, children }: { number: number; title: string; done: boolean | null; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${number}`} className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            done ? "bg-accent text-surface" : done === false ? "bg-notice-soft text-notice" : "bg-bg text-muted"
          }`}
        >
          {done ? "✓" : number}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`step-${number}`} className="text-base font-semibold">
            {title}
            <span className="sr-only">{done ? " (done)" : done === false ? " (needs attention)" : ""}</span>
          </h2>
          <div className="mt-2 text-sm">{children}</div>
        </div>
      </div>
    </section>
  );
}

export default async function MonthEndPage({ searchParams }: PageProps<"/month-end">) {
  const session = await requireHousehold();
  const householdId = session.household.id;
  const data = getDataSource();
  const today = householdToday(session.household);
  const thisMonth = monthKey(today);
  const requested = firstParam((await searchParams).month) ?? "";
  // Defaults to the last finished month.
  const month = isMonthKey(requested) && requested <= thisMonth ? requested : addMonths(thisMonth, -1);
  const range = monthRange(month);
  const finished = month < thisMonth;

  const [coverage, monthRows, budget, balances, closing] = await Promise.all([
    loadCoverage(householdId),
    data.listTransactions(householdId, range),
    loadBudget(session, { kind: "everyone" }, month),
    data.listBalances(householdId),
    data.getMonthClosing(householdId, month),
  ]);

  // 2. Coverage: every imported account's activity for the whole month.
  const required = requiredAccounts(coverage.accounts, coverage.periods, range.from);
  const accountName = (id: string) => {
    const account = coverage.accounts.find((a) => a.id === id);
    return account ? `${account.institution} ${account.account_name}` : "";
  };
  const coverageRows = required.map((account) => ({
    id: account.id,
    gaps: gapsIn(coverage.periods, account.id, range.from, finished ? range.to : today),
  }));
  const missing = coverageRows.filter((row) => row.gaps.length > 0);
  const neverImported = importableAccounts(coverage.accounts).filter(
    (account) => account.is_active && ["checking", "savings", "credit_card"].includes(account.account_type) && !coverage.periods.some((p) => p.account_id === account.id),
  );

  // 3. Decisions still waiting in the month.
  const waiting = monthRows.rows.filter((row) => row.review_status === "needs_review").length;

  // 4. Budget against actual.
  const lines = budget.progress
    .filter((p) => p.budgetCents > 0 && p.line.kind !== "sinking_fund")
    .map((p) => ({ p, status: budgetStatus(p, formatCentsRounded) }));
  const over = lines.filter((line) => line.status.over);
  const name = (id: string | null) => budget.categories.find((category) => category.id === id)?.name ?? "";

  // 5. Balances that should be updated to the end of the month.
  const netWorthAccounts = activeAccounts(coverage.accounts).filter((account) => !holdsTransactions(account.account_type) || ["brokerage", "retirement", "hsa", "crypto", "mortgage", "loan"].includes(account.account_type));
  const latest = balancesOn(balances, range.to);
  const outdated = netWorthAccounts.filter((account) => {
    const balance = latest.get(account.id);
    return !balance || balance.as_of < range.from;
  });

  // Since closing: what changed (counted the same way, without unrevealed private purchases).
  const now = sharedSnapshot(monthRows.rows, today, viewOptions(session));
  const changed =
    closing &&
    (closing.spending_cents !== now.spending_cents ||
      closing.income_cents !== now.income_cents ||
      closing.transaction_count !== now.transaction_count);
  const monthLink = (target: string) => `/month-end${queryString({ month: target })}`;

  return (
    <>
      <PageHeader title="Month-end review" subtitle={`${formatMonth(month)} · ${session.household.name}`}>
        <Stepper
          showLabel
          label={formatMonth(month)}
          previousHref={monthLink(addMonths(month, -1))}
          nextHref={month < thisMonth ? monthLink(addMonths(month, 1)) : null}
        />
      </PageHeader>

      {!finished && (
        <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          {formatMonth(month)} isn&apos;t over yet; this is how it looks so far. It can be closed once it ends.
        </p>
      )}
      {closing && (
        <p className={`mb-4 rounded-xl px-4 py-3 text-sm ${changed ? "bg-notice-soft text-notice" : "border border-line bg-surface"}`} role="status">
          Closed {formatDayWithYear(closing.closed_at.slice(0, 10))}
          {closing.closed_by ? ` by ${session.members.find((m) => m.id === closing.closed_by)?.name ?? "someone"}` : ""}.{" "}
          {changed
            ? `Since then: spending ${formatEffectRounded(now.spending_cents - closing.spending_cents)}, income ${formatEffectRounded(
                now.income_cents - closing.income_cents,
              )}, ${now.transaction_count - closing.transaction_count >= 0 ? "+" : ""}${now.transaction_count - closing.transaction_count} transactions — usually a late refund or a correction.`
            : "Nothing has changed since."}
        </p>
      )}

      <div className="flex flex-col gap-4">
        <Step number={1} title={`Month: ${formatMonth(month)}`} done={finished}>
          <p className="text-muted">
            Use the arrows to pick a different month. The review covers the whole household; private purchases that
            haven&apos;t been revealed count only for their owner.
          </p>
        </Step>

        <Step number={2} title="Check every account was imported" done={missing.length === 0 && required.length > 0}>
          {required.length === 0 ? (
            <p className="text-muted">No account activity imported for this month yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {coverageRows.map((row) => (
                <li key={row.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span className="min-w-0 break-anywhere">{accountName(row.id)}</span>
                  <span className={row.gaps.length > 0 ? "text-notice" : "text-muted"}>
                    {row.gaps.length === 0
                      ? "✓ complete"
                      : `missing ${row.gaps.map((gap) => (gap.from === gap.to ? formatDayWithYear(gap.from) : `${formatDayWithYear(gap.from)} – ${formatDayWithYear(gap.to)}`)).join(", ")}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {neverImported.length > 0 && (
            <p className="mt-2 text-notice">Never imported: {neverImported.map((a) => `${a.institution} ${a.account_name}`).join(", ")}.</p>
          )}
          {missing.length > 0 && (
            <>
              <p className="mt-2 text-muted">
                Months with missing activity are left out of averages and forecasts. <TextLink href="/import">Import it</TextLink>, or
                confirm an account simply had nothing new:
              </p>
              {!session.isDemo && (
                <CoverageConfirm accounts={missing.map((row) => ({ id: row.id, name: accountName(row.id) }))} latest={finished ? range.to : today} />
              )}
            </>
          )}
        </Step>

        <Step number={3} title="Resolve remaining decisions" done={waiting === 0}>
          {waiting === 0 ? (
            <p className="text-muted">Every transaction in {formatMonth(month)} is sorted.</p>
          ) : (
            <p>
              {waiting} {waiting === 1 ? "transaction" : "transactions"} from {formatMonth(month)} still{" "}
              {waiting === 1 ? "needs" : "need"} a decision.{" "}
              <TextLink href={`/transactions${queryString({ month, review: 1 })}`}>Show them</TextLink>
            </p>
          )}
        </Step>

        <Step number={4} title="Compare budget and actual spending" done={lines.length === 0 ? null : over.length === 0}>
          {lines.length === 0 ? (
            <p className="text-muted">
              No budget for {formatMonth(month)}. <TextLink href={`/budget${queryString({ month })}`}>Set one up</TextLink>
            </p>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Metric size="supporting" label="Budgeted" value={formatCentsRounded(budget.totals.budgetCents)} />
                <Metric size="supporting" label="Spent in budgets" value={formatCentsRounded(budget.totals.spentCents)} />
                <Metric size="supporting" label="Not in a budget" value={formatCentsRounded(budget.unbudgetedCents)} />
              </div>
              <BarList
                empty=""
                items={lines.map(({ p, status }) => ({
                  key: p.line.id,
                  label: `${name(p.line.subcategory_id ?? p.line.category_id)}${
                    p.line.scope === "person"
                      ? ` · ${session.members.find((m) => m.id === p.line.person_id)?.name ?? ""}`
                      : p.line.scope === "shared"
                        ? " · Shared"
                        : ""
                  }`,
                  value: `${formatCentsRounded(p.spentCents)} of ${formatCentsRounded(p.budgetCents)}`,
                  fraction: status.fraction,
                  tone: status.tone,
                  note: status.over ? `▲ ${status.text}` : status.text,
                  status: status.text,
                }))}
              />
              <p className="mt-2">
                <TextLink href={`/budget${queryString({ month })}`}>Open {formatMonth(month)}&apos;s budget</TextLink>
              </p>
            </>
          )}
        </Step>

        <Step number={5} title="Update balances" done={netWorthAccounts.length === 0 ? null : outdated.length === 0}>
          {outdated.length === 0 ? (
            <p className="text-muted">Every investment, property and loan balance is from {formatMonth(month)} or later.</p>
          ) : (
            <p>
              No balance from {formatMonth(month)} yet for {outdated.map((a) => a.account_name).join(", ")}.{" "}
              <TextLink href="/net-worth">Update on Net Worth</TextLink>
            </p>
          )}
        </Step>

        <Step number={6} title="Download records" done={null}>
          <div className="flex flex-wrap gap-2">
            <a href={`/reports/ledger${queryString({ month })}`} className={secondaryButton}>
              Every transaction (CSV, exact cents)
            </a>
            <a href={`/reports/export${queryString({ end: month < thisMonth ? month : undefined, count: 3 })}`} className={secondaryButton}>
              Category summary (CSV)
            </a>
            <a href="/settings/backup" className={secondaryButton}>
              Full backup (JSON)
            </a>
          </div>
          <p className="mt-2 text-[13px] text-muted">
            Downloads include only what you can see: the other person&apos;s unrevealed private purchases are left out.
          </p>
        </Step>

        {finished && !session.isDemo && (
          <Card>
            <p className="mb-3 text-sm text-muted">
              Closing records {formatMonth(month)}&apos;s totals so later changes can be pointed out. It doesn&apos;t lock
              anything: late refunds and corrections still count.
            </p>
            <CloseMonthButton month={month} label={closing ? "Close again with today's totals" : `Mark ${formatMonth(month)} as reviewed`} />
          </Card>
        )}
        <p className="text-[13px] text-muted">
          Looking for averages across months? <Link href={`/reports${queryString({ complete: 1 })}`} className="font-medium text-accent hover:underline">Reports, completed months only</Link>.
        </p>
      </div>
    </>
  );
}
