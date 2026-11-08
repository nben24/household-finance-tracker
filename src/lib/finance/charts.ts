// The numbers behind the Charts page, plus a plain-English sentence for each
// chart. Pure functions over view entries, so they always agree with the
// dashboard and reports.

import { addMonths, daysBetween, formatDay, formatMonth, monthRange } from "@/lib/dates";
import type { CategoryRow, TransactionRow } from "@/lib/db/types";
import { formatCentsRounded, toCents } from "@/lib/money";
import { isPrivateNow, PRIVATE_LABEL } from "./privacy";
import { countsAsSpending } from "./summary";
import { entriesByCategory, viewTotals, type Entry, type View } from "./views";

/** How many categories get their own color; the rest are "Other". */
export const NAMED_CATEGORIES = 5;
export const OTHER = "other";

export interface Slice {
  /** category id, or OTHER */
  id: string;
  name: string;
  cents: number;
  /** 0–1 of the month's spending */
  share: number;
  /** 1–5 for a named category, 0 for Other */
  slot: number;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const inMonth = (month: string) => {
  const { from, to } = monthRange(month);
  return (entry: Entry) => entry.date >= from && entry.date <= to;
};

/**
 * The categories that keep their color on every chart: the five with the most
 * spending over the whole range, so a color never changes from month to month.
 */
export function namedCategories(entries: Entry[], categories: Pick<CategoryRow, "id" | "name">[]): string[] {
  return entriesByCategory(entries, categories)
    .filter((total) => total.cents > 0 && total.id !== null && categories.some((category) => category.id === total.id))
    .slice(0, NAMED_CATEGORIES)
    .map((total) => total.id as string);
}

/** One month's spending as donut slices: the named categories, then Other. */
export function spendingSlices(
  entries: Entry[],
  categories: Pick<CategoryRow, "id" | "name">[],
  month: string,
  named: string[],
): Slice[] {
  const totals = entriesByCategory(entries.filter(inMonth(month)), categories);
  const total = sum(totals.map((t) => t.cents));
  if (total <= 0) return [];
  const slices: Slice[] = named.map((id, index) => {
    const cents = totals.find((t) => t.id === id)?.cents ?? 0;
    return {
      id,
      name: categories.find((c) => c.id === id)?.name ?? "Unknown",
      cents,
      share: cents / total,
      slot: index + 1,
    };
  });
  const otherCents = total - sum(slices.map((slice) => slice.cents));
  if (otherCents !== 0)
    slices.push({ id: OTHER, name: "Everything else", cents: otherCents, share: otherCents / total, slot: 0 });
  return slices.filter((slice) => slice.cents > 0);
}

export interface MonthFlow {
  month: string;
  label: string;
  incomeCents: number;
  spendingCents: number;
  setAsideCents: number;
  leftOverCents: number;
}

/** Money in vs. money out for each month, oldest first. */
export function monthlyFlow(entries: Entry[], view: View, months: string[]): MonthFlow[] {
  return months.map((month) => {
    const totals = viewTotals(entries.filter(inMonth(month)), view);
    return {
      month,
      label: formatMonth(month),
      // the shared account's money in is what both people paid into it
      incomeCents: totals.incomeCents + (view.kind === "shared" ? totals.contributionCents : 0),
      spendingCents: totals.spendingCents,
      setAsideCents: totals.savedCents + totals.investedCents,
      leftOverCents: totals.netCents,
    };
  });
}

export interface Pace {
  month: string;
  daysInMonth: number;
  /** the last day with actual numbers (0 before the month starts) */
  throughDay: number;
  /** spending so far, by day of month (index 0 = day 1) */
  soFar: number[];
  /** a typical month's spending by the end of each day, or null without history */
  typical: number[] | null;
  /** months the typical line is based on */
  historyMonths: number;
}

function cumulativeByDay(entries: Entry[], month: string, days: number): number[] {
  const daily = Array.from({ length: days }, () => 0);
  for (const entry of entries) {
    if (entry.kind !== "spending" || !inMonth(month)(entry)) continue;
    daily[Number(entry.date.slice(8)) - 1] += entry.cents;
  }
  let running = 0;
  return daily.map((cents) => Math.round((running += cents)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * Spending so far this month, day by day, against a typical month: for each
 * day, the middle value of the earlier months' running totals (up to six full
 * months the data covers; a shorter month carries its last day forward).
 */
export function spendingPace(entries: Entry[], month: string, today: string, dataStartsOn: string | null): Pace {
  const { from, to } = monthRange(month);
  const daysInMonth = Number(to.slice(8));
  const throughDay = today < from ? 0 : today > to ? daysInMonth : Number(today.slice(8));
  const soFar = cumulativeByDay(entries, month, daysInMonth).slice(0, throughDay);
  const history = [1, 2, 3, 4, 5, 6]
    .map((back) => addMonths(month, -back))
    .filter((past) => dataStartsOn !== null && dataStartsOn <= `${past}-01`)
    .map((past) => {
      const days = Number(monthRange(past).to.slice(8));
      const line = cumulativeByDay(entries, past, days);
      return Array.from({ length: daysInMonth }, (_, day) => line[Math.min(day, days - 1)]);
    });
  const typical = history.length
    ? Array.from({ length: daysInMonth }, (_, day) => median(history.map((line) => line[day])))
    : null;
  return { month, daysInMonth, throughDay, soFar, typical, historyMonths: history.length };
}

export interface Purchase {
  id: string;
  date: string;
  cents: number;
  merchant: string;
  categoryId: string | null;
}

type PurchaseRow = Pick<
  TransactionRow,
  | "id"
  | "transaction_date"
  | "amount"
  | "transaction_type"
  | "person_id"
  | "normalized_merchant"
  | "category_id"
  | "expense_type"
  | "is_private"
  | "private_until"
>;

/**
 * Each purchase in the month that counts toward the view, largest first. Fixed
 * bills (mortgage, insurance, subscriptions) are left out: they'd dwarf the
 * purchases worth noticing. Someone else's private purchase shows only as
 * "Private purchase".
 */
export function purchases(rows: PurchaseRow[], view: View, month: string, today: string, viewerId: string): Purchase[] {
  const { from, to } = monthRange(month);
  return rows
    .filter(
      (row) =>
        row.transaction_date >= from &&
        row.transaction_date <= to &&
        row.amount < 0 &&
        countsAsSpending(row) &&
        row.expense_type !== "fixed" &&
        (view.kind === "everyone" ||
          (view.kind === "shared" ? row.person_id === null : row.person_id === view.personId)),
    )
    .map((row) => {
      const hidden = row.person_id !== viewerId && isPrivateNow(row, today);
      return {
        id: row.id,
        date: row.transaction_date,
        cents: -toCents(row.amount),
        merchant: hidden ? PRIVATE_LABEL : row.normalized_merchant,
        categoryId: hidden ? null : row.category_id,
      };
    })
    .sort((a, b) => b.cents - a.cents || a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// What each chart is saying, in a sentence
// ---------------------------------------------------------------------------

const percent = (share: number) => `${Math.round(share * 100)}%`;

export function slicesSentence(slices: Slice[], month: string): string {
  const named = slices.filter((slice) => slice.slot > 0).sort((a, b) => b.cents - a.cents);
  const total = sum(slices.map((slice) => slice.cents));
  if (total === 0 || named.length === 0) return `No spending recorded in ${formatMonth(month)} yet.`;
  const [top, second] = named;
  return `${top.name} was the biggest share of ${formatMonth(month)}'s ${formatCentsRounded(total)}: ${formatCentsRounded(top.cents)}, or ${percent(top.share)}${
    second ? `, followed by ${second.name} at ${percent(second.share)}` : ""
  }.`;
}

export function flowSentence(flow: MonthFlow[]): string {
  const complete = flow.filter((month) => month.incomeCents !== 0 || month.spendingCents !== 0);
  if (complete.length === 0) return "No money in or out recorded in these months yet.";
  const ahead = complete.filter((month) => month.leftOverCents >= 0).length;
  const averageLeft = Math.round(sum(complete.map((month) => month.leftOverCents)) / complete.length);
  const best = [...complete].sort((a, b) => b.leftOverCents - a.leftOverCents)[0];
  return `${ahead} of ${complete.length} months ended with money left over after spending and saving; on average ${
    averageLeft >= 0 ? `${formatCentsRounded(averageLeft)} left over` : `${formatCentsRounded(-averageLeft)} short`
  } a month. ${best.label} was the strongest month.`;
}

export function paceSentence(pace: Pace): string {
  if (pace.throughDay === 0) return `${formatMonth(pace.month)} hasn't started yet.`;
  const spent = pace.soFar[pace.throughDay - 1] ?? 0;
  const day = `${formatDay(`${pace.month}-${String(pace.throughDay).padStart(2, "0")}`)}`;
  if (!pace.typical)
    return `${formatCentsRounded(spent)} spent through ${day}. A typical month appears once there's a full month of history.`;
  const usual = pace.typical[pace.throughDay - 1];
  const difference = spent - usual;
  if (Math.abs(difference) < Math.max(2500, usual * 0.05)) {
    return `${formatCentsRounded(spent)} spent through ${day}, right about where a typical month is.`;
  }
  return `${formatCentsRounded(spent)} spent through ${day}: ${formatCentsRounded(Math.abs(difference))} ${
    difference > 0 ? "more" : "less"
  } than a typical month by this point.`;
}

export function purchasesSentence(list: Purchase[], month: string): string {
  if (list.length === 0) return `No purchases in ${formatMonth(month)} yet (fixed bills aren't shown here).`;
  const [biggest] = list;
  const total = sum(list.map((purchase) => purchase.cents));
  const top3 = sum(list.slice(0, 3).map((purchase) => purchase.cents));
  return `The biggest purchase was ${formatCentsRounded(biggest.cents)} at ${biggest.merchant} on ${formatDay(biggest.date)}. ${
    list.length > 3 ? `The three largest made up ${percent(top3 / total)} of ${list.length} purchases.` : ""
  } Fixed bills like the mortgage aren't shown.`.replace("  ", " ");
}

/** Days into the month, for placing a purchase along the x-axis (0 = the 1st). */
export function dayIndex(date: string, month: string): number {
  return daysBetween(`${month}-01`, date);
}
