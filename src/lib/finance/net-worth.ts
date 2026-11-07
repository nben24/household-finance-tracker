// Net worth: what you own minus what you owe, from dated balance snapshots.

import { addMonths, daysBetween, monthRange } from "@/lib/dates";
import type { AccountBalanceRow, AccountRow, AccountType } from "@/lib/db/types";
import { toCents } from "@/lib/money";
import type { View } from "./views";

/** Kinds of account whose balance is money owed. */
const DEBTS: AccountType[] = ["credit_card", "mortgage", "loan"];

export function isDebt(type: AccountType): boolean {
  return DEBTS.includes(type);
}

/** Kinds of account that never have transactions to import or add (a home, a car). */
export function holdsTransactions(type: AccountType): boolean {
  return type !== "property" && type !== "vehicle";
}

/** A balance older than this is pointed out as possibly out of date. */
export const STALE_AFTER_DAYS = 45;

type Account = Pick<AccountRow, "id" | "account_type" | "owner_user_id" | "is_active">;
type Balance = Pick<AccountBalanceRow, "account_id" | "as_of" | "balance">;

/** Accounts that belong in a view: everything, one person's own, or the joint ones. */
export function accountsForView<T extends Account>(accounts: T[], view: View): T[] {
  return accounts.filter(
    (account) =>
      account.is_active &&
      (view.kind === "everyone" ||
        (view.kind === "shared" ? account.owner_user_id === null : account.owner_user_id === view.personId)),
  );
}

/** Each account's most recent balance on or before `date`. */
export function balancesOn(balances: Balance[], date: string): Map<string, Balance> {
  const latest = new Map<string, Balance>();
  for (const balance of balances) {
    if (balance.as_of > date) continue;
    const current = latest.get(balance.account_id);
    if (!current || balance.as_of > current.as_of) latest.set(balance.account_id, balance);
  }
  return latest;
}

export interface NetWorth {
  assetsCents: number;
  debtsCents: number;
  netCents: number;
  /** accounts with no balance yet on that date */
  missing: string[];
  /** accounts whose latest balance is old */
  stale: string[];
}

export function netWorthOn(accounts: Account[], balances: Balance[], date: string): NetWorth {
  const latest = balancesOn(balances, date);
  let assetsCents = 0;
  let debtsCents = 0;
  const missing: string[] = [];
  const stale: string[] = [];
  for (const account of accounts) {
    const balance = latest.get(account.id);
    if (!balance) {
      missing.push(account.id);
      continue;
    }
    if (daysBetween(balance.as_of, date) > STALE_AFTER_DAYS) stale.push(account.id);
    if (isDebt(account.account_type)) debtsCents += toCents(balance.balance);
    else assetsCents += toCents(balance.balance);
  }
  return { assetsCents, debtsCents, netCents: assetsCents - debtsCents, missing, stale };
}

/**
 * Net worth at the end of each of the last `count` months (the current month
 * as of today). An account counts from its first balance onward; months before
 * any balance existed are left out rather than shown as zero.
 */
export function monthlyHistory(
  accounts: Account[],
  balances: Balance[],
  today: string,
  count: number,
): { month: string; date: string; netWorth: NetWorth }[] {
  const firstBalance = balances.reduce<string | null>((first, b) => (!first || b.as_of < first ? b.as_of : first), null);
  const currentMonth = today.slice(0, 7);
  const months = Array.from({ length: count }, (_, index) => addMonths(currentMonth, index - (count - 1)));
  return months
    .map((month) => {
      const date = month === currentMonth ? today : monthRange(month).to;
      return { month, date, netWorth: netWorthOn(accounts, balances, date) };
    })
    .filter((entry) => firstBalance !== null && entry.date >= firstBalance);
}

/**
 * The latest balance shown in a bank export, for recording automatically:
 * the balance on the last date in the file.
 */
export function latestBalance(
  entries: { date: string; balance: number | null }[],
): { date: string; balance: number } | null {
  let latest: { date: string; balance: number } | null = null;
  for (const entry of entries) {
    if (entry.balance === null || !Number.isFinite(entry.balance)) continue;
    // ">=" so that, within one day, the last row in the file wins.
    if (!latest || entry.date >= latest.date) latest = { date: entry.date, balance: entry.balance };
  }
  return latest;
}
