// Which dates each account's imported activity covers, and so which months
// are complete enough to learn from. Coverage is recorded per import (see the
// account_coverage migration); it is never inferred from a single last
// transaction date.

import { addDays, monthRange } from "@/lib/dates";
import type { AccountCoverageRow, AccountRow } from "@/lib/db/types";
import { isCashAccount } from "@/lib/import/manual";
import { holdsTransactions } from "./net-worth";

type Period = Pick<AccountCoverageRow, "account_id" | "covered_from" | "covered_through" | "source">;
type Account = Pick<AccountRow, "id" | "account_type" | "institution" | "is_active"> &
  Partial<Pick<AccountRow, "closed_on">>;

export interface Range {
  from: string;
  through: string;
  /** every period in it is only an estimate */
  estimated: boolean;
}

/** One account's covered dates as non-overlapping ranges, oldest first (touching periods are joined). */
export function mergedRanges(periods: Period[], accountId: string): Range[] {
  const own = periods
    .filter((period) => period.account_id === accountId)
    .sort((a, b) => a.covered_from.localeCompare(b.covered_from));
  const ranges: Range[] = [];
  for (const period of own) {
    const last = ranges[ranges.length - 1];
    if (last && period.covered_from <= addDays(last.through, 1)) {
      if (period.covered_through > last.through) last.through = period.covered_through;
      last.estimated = last.estimated && period.source === "estimated";
    } else {
      ranges.push({ from: period.covered_from, through: period.covered_through, estimated: period.source === "estimated" });
    }
  }
  return ranges;
}

/** Whether one account's coverage spans every day from `from` to `to`. */
export function accountCovers(periods: Period[], accountId: string, from: string, to: string): boolean {
  return mergedRanges(periods, accountId).some((range) => range.from <= from && range.through >= to);
}

/** Accounts that are imported at all: bank, card or savings activity, not a home, car or cash. */
export function importableAccounts<T extends Account>(accounts: T[]): T[] {
  return accounts.filter((account) => holdsTransactions(account.account_type) && !isCashAccount(account));
}

/**
 * Accounts whose activity must be covered for a period to count as complete:
 * every account that has ever been imported (has any coverage), unless it was
 * retired before the period began. An account imported only from June makes
 * January to May incomplete, because those months are missing its activity.
 * Accounts never imported (an investment account kept only for net worth)
 * don't block anything; they're listed as "not imported yet" instead.
 */
export function requiredAccounts<T extends Account>(accounts: T[], periods: Period[], from: string): T[] {
  const imported = new Set(periods.map((period) => period.account_id));
  return importableAccounts(accounts).filter(
    (account) =>
      imported.has(account.id) &&
      // a retired account without a closing date isn't required (we don't know when it ended)
      (account.is_active || Boolean(account.closed_on)) &&
      (!account.closed_on || account.closed_on > from),
  );
}

/** Every required account covers every day of the range. */
export function rangeIsComplete(accounts: Account[], periods: Period[], from: string, to: string): boolean {
  const required = requiredAccounts(accounts, periods, from);
  if (required.length === 0) return false;
  return required.every((account) => accountCovers(periods, account.id, from, to));
}

/** A whole month ('YYYY-MM') is complete. */
export function monthIsComplete(accounts: Account[], periods: Period[], month: string): boolean {
  const { from, to } = monthRange(month);
  return rangeIsComplete(accounts, periods, from, to);
}

export interface AccountCoverageStatus {
  accountId: string;
  /** last day of the most recent covered stretch, or null if never imported */
  through: string | null;
  /** that stretch is only an estimate from before coverage was tracked */
  estimated: boolean;
}

export interface CoverageSummary {
  accounts: AccountCoverageStatus[];
  /** the most recent date any account is covered through */
  latest: string | null;
  /** how many accounts are covered through `latest` */
  upToDate: number;
  total: number;
}

/**
 * "3 of 4 accounts updated through November 13": where each active imported
 * account's coverage ends. Importable accounts never imported are listed with
 * `through: null` so they can be imported or retired.
 */
export function coverageSummary(accounts: Account[], periods: Period[]): CoverageSummary {
  // Everyday accounts are expected to be imported; others (a mortgage, a
  // brokerage) only appear once something has been imported for them.
  const imported = new Set(periods.map((period) => period.account_id));
  const everyday: Account["account_type"][] = ["checking", "savings", "credit_card"];
  const shown = importableAccounts(accounts).filter(
    (account) => account.is_active && (imported.has(account.id) || everyday.includes(account.account_type)),
  );
  const statuses = shown.map((account) => {
    const ranges = mergedRanges(periods, account.id);
    const last = ranges[ranges.length - 1];
    return { accountId: account.id, through: last?.through ?? null, estimated: last?.estimated ?? false };
  });
  const tracked = statuses.filter((status) => status.through !== null);
  const latest = tracked.reduce<string | null>((max, status) => (!max || status.through! > max ? status.through : max), null);
  return {
    accounts: statuses,
    latest,
    upToDate: latest ? tracked.filter((status) => status.through! >= latest).length : 0,
    total: tracked.length,
  };
}

/** Gaps inside a month for one account: stretches with no coverage. */
export function gapsIn(periods: Period[], accountId: string, from: string, to: string): { from: string; to: string }[] {
  const gaps: { from: string; to: string }[] = [];
  let cursor = from;
  for (const range of mergedRanges(periods, accountId)) {
    if (range.through < cursor) continue;
    if (range.from > to) break;
    if (range.from > cursor) gaps.push({ from: cursor, to: addDays(range.from, -1) < to ? addDays(range.from, -1) : to });
    cursor = addDays(range.through, 1);
    if (cursor > to) return gaps;
  }
  if (cursor <= to) gaps.push({ from: cursor, to });
  return gaps;
}
