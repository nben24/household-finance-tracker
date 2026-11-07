import type { Metadata } from "next";
import { AddAccountForm, BalanceControls } from "@/components/net-worth/net-worth-controls";
import { BarList, Card, Metric, PageHeader } from "@/components/ui";
import { ViewSwitcher } from "@/components/view-switcher";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/config";
import { getDataSource, requireHousehold } from "@/lib/data";
import { daysBetween, formatDayWithYear, formatShortMonth, todayInTimeZone } from "@/lib/dates";
import type { AccountRow, AccountType } from "@/lib/db/types";
import {
  STALE_AFTER_DAYS,
  accountsForView,
  balancesOn,
  isDebt,
  monthlyHistory,
  netWorthOn,
} from "@/lib/finance/net-worth";
import { parseView, viewLabel } from "@/lib/finance/view-param";
import { ACCOUNT_TYPE_LABELS } from "@/lib/labels";
import { formatCents, formatCentsRounded, toCents } from "@/lib/money";
import { firstParam } from "@/lib/params";

export const metadata: Metadata = { title: "Net Worth" };

const HISTORY_MONTHS = 12;

function signed(cents: number): string {
  if (cents === 0) return "no change";
  return `${cents > 0 ? "+" : "−"}${formatCentsRounded(Math.abs(cents))}`;
}

export default async function NetWorthPage({ searchParams }: PageProps<"/net-worth">) {
  const session = await requireHousehold();
  const view = parseView(firstParam((await searchParams).view), session.members);
  const data = getDataSource();
  const today = todayInTimeZone(HOUSEHOLD_TIME_ZONE);
  const [allAccounts, balances] = await Promise.all([
    data.listAccounts(session.household.id),
    data.listBalances(session.household.id),
  ]);

  const accounts = accountsForView(allAccounts, view);
  const latest = balancesOn(balances, today);
  const current = netWorthOn(accounts, balances, today);
  const history = monthlyHistory(accounts, balances, today, HISTORY_MONTHS);
  const lastMonth = history.length >= 2 ? history[history.length - 2] : null;
  const memberNames = new Map(session.members.map((member) => [member.id, member.name]));
  const retired = allAccounts.filter((account) => !account.is_active && accountsForView([{ ...account, is_active: true }], view).length > 0);

  const historyFor = (accountId: string) =>
    balances
      .filter((balance) => balance.account_id === accountId)
      .sort((a, b) => b.as_of.localeCompare(a.as_of))
      .slice(0, 6)
      .map((balance) => ({ id: balance.id, asOf: balance.as_of, cents: toCents(balance.balance), fromImport: balance.source === "import" }));

  const section = (title: string, list: AccountRow[], debt: boolean) => {
    const byType = new Map<AccountType, AccountRow[]>();
    for (const account of list) byType.set(account.account_type, [...(byType.get(account.account_type) ?? []), account]);
    const total = list.reduce((sum, account) => sum + toCents(latest.get(account.id)?.balance ?? 0), 0);
    return (
      <Card title={title} action={<span className="text-sm font-semibold tabular">{formatCents(total)}</span>}>
        {list.length === 0 ? (
          <p className="text-sm text-muted">{debt ? "No debts added." : "No accounts added."}</p>
        ) : (
          [...byType.entries()].map(([type, entries]) => (
            <div key={type} className="mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{ACCOUNT_TYPE_LABELS[type]}</h3>
              <ul className="divide-y divide-line">
                {entries.map((account) => {
                  const balance = latest.get(account.id);
                  const stale = balance && daysBetween(balance.as_of, today) > STALE_AFTER_DAYS;
                  const owner = view.kind === "everyone" ? (account.owner_user_id ? memberNames.get(account.owner_user_id) : "Shared") : null;
                  return (
                    <li key={account.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {account.institution !== account.account_name ? `${account.institution} ${account.account_name}` : account.account_name}
                          {owner && <span className="ml-2 rounded-full bg-bg px-2 py-0.5 text-xs font-normal text-muted">{owner}</span>}
                        </p>
                        <p className={`text-xs ${stale ? "text-notice" : "text-muted"}`}>
                          {balance
                            ? `${stale ? "Last updated" : "As of"} ${formatDayWithYear(balance.as_of)}`
                            : "No balance yet — add one"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-semibold tabular">{balance ? formatCents(toCents(balance.balance)) : "—"}</span>
                        {!session.isDemo && (
                          <BalanceControls accountId={account.id} today={today} history={historyFor(account.id)} active />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </Card>
    );
  };

  const owned = accounts.filter((account) => !isDebt(account.account_type));
  const owed = accounts.filter((account) => isDebt(account.account_type));
  const largest = Math.max(1, ...history.map((entry) => Math.abs(entry.netWorth.netCents)));

  return (
    <>
      <PageHeader title="Net Worth" subtitle={`What you own minus what you owe · ${viewLabel(view, session.members)}`} />
      <ViewSwitcher path="/net-worth" current={view} members={session.members} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="What you own" value={formatCentsRounded(current.assetsCents)} />
        <Metric label="What you owe" value={formatCentsRounded(current.debtsCents)} />
        <Metric label="Net worth" value={formatCentsRounded(current.netCents)} />
        <Metric
          label="Since last month"
          value={lastMonth ? signed(current.netCents - lastMonth.netWorth.netCents) : "—"}
          hint={lastMonth ? `vs end of ${formatShortMonth(lastMonth.month)}` : "needs a month of history"}
        />
      </div>

      {current.stale.length > 0 && (
        <p className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          {current.stale.length} {current.stale.length === 1 ? "balance hasn't" : "balances haven't"} been updated in over{" "}
          {STALE_AFTER_DAYS} days, so the totals may be out of date. Use “Update” next to each one.
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
        {section("What you own", owned, false)}
        {section("What you owe", owed, true)}
      </div>

      {history.length > 0 && (
        <Card className="mt-4" title="Net worth by month">
          <BarList
            empty=""
            items={history.map((entry) => ({
              key: entry.month,
              label: formatShortMonth(entry.month),
              value: formatCentsRounded(entry.netWorth.netCents),
              fraction: Math.max(0, entry.netWorth.netCents) / largest,
              note: entry.date === today ? "today" : undefined,
            }))}
          />
          <p className="mt-3 text-xs text-muted">
            Each month uses the latest balance on or before its last day. Accounts count from their first balance onward.
          </p>
        </Card>
      )}

      {!session.isDemo && (
        <Card className="mt-4" title="Add an account">
          <p className="mb-3 text-xs text-muted">
            For anything you own or owe that isn&apos;t already listed: retirement and investment accounts, crypto, your
            home or car at an estimated value, the mortgage, loans. Checking balances update themselves when you import
            Truist or Bank of America files.
          </p>
          <AddAccountForm
            people={session.members.map((member) => ({ id: member.id, name: member.name }))}
            defaultOwnerId={view.kind === "person" ? view.personId : view.kind === "shared" ? "" : session.user.id}
            today={today}
          />
        </Card>
      )}

      {retired.length > 0 && !session.isDemo && (
        <details className="mt-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
          <summary className="cursor-pointer text-sm font-semibold">Retired accounts ({retired.length})</summary>
          <ul className="mt-2 divide-y divide-line">
            {retired.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  {account.institution} {account.account_name}
                </span>
                <BalanceControls accountId={account.id} today={today} history={[]} active={false} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
