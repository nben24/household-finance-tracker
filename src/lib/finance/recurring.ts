// Finds charges (and income) that repeat on a steady rhythm, from history alone.
//
// A merchant is recurring when its transactions arrive at a regular interval
// (weekly … yearly, or on two fixed days each month) with consistent amounts.
// Everyday habits with varying amounts (coffee, groceries) are not flagged, and
// a one-off charge from a regular merchant (a gym's yearly fee, a lump-sum
// insurance payment) doesn't hide the regular pattern or count as a price change.

import { addDays, daysBetween } from "@/lib/dates";
import type { TransactionRow } from "@/lib/db/types";
import { countsAsSpending } from "@/lib/finance/summary";
import { toCents } from "@/lib/money";

export type Frequency = "weekly" | "biweekly" | "semimonthly" | "monthly" | "quarterly" | "semiannual" | "annual";

const FREQUENCIES: { name: Frequency; days: number; tolerance: number; perYear: number; months?: number }[] = [
  { name: "weekly", days: 7, tolerance: 2, perYear: 52 },
  { name: "biweekly", days: 14, tolerance: 3, perYear: 26 },
  { name: "monthly", days: 30.44, tolerance: 4, perYear: 12, months: 1 },
  { name: "quarterly", days: 91.3, tolerance: 10, perYear: 4, months: 3 },
  { name: "semiannual", days: 182.6, tolerance: 15, perYear: 2, months: 6 },
  { name: "annual", days: 365.25, tolerance: 20, perYear: 1, months: 12 },
];
const PER_YEAR: Record<Frequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
};

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "every week",
  biweekly: "every 2 weeks",
  semimonthly: "twice a month",
  monthly: "monthly",
  quarterly: "every 3 months",
  semiannual: "every 6 months",
  annual: "yearly",
};

/** A charge this far from the usual amount is a one-off, not the regular charge. */
const ONE_OFF_RATIO = 0.5;
/** A bill whose day of the month moves more than this is shown as "around" a date. */
const FLEXIBLE_DAY_SPREAD = 4;

type Row = Pick<
  TransactionRow,
  | "id"
  | "transaction_date"
  | "amount"
  | "transaction_type"
  | "normalized_merchant"
  | "person_id"
  | "category_id"
  | "subcategory_id"
>;

export interface Recurring {
  /** stable key: lowercased merchant + kind + owner */
  key: string;
  merchant: string;
  kind: "charge" | "income";
  /** whose it is: a member id, or null for shared */
  personId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  frequency: Frequency;
  /** for "twice a month": the two days of the month */
  daysOfMonth: [number, number] | null;
  /** the regular amount (the latest one, unless that was a one-off), positive */
  amountCents: number;
  monthlyCents: number;
  annualCents: number;
  count: number;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  /** the day of the month moves around, so the next date is approximate */
  flexibleDay: boolean;
  confidence: "high" | "medium";
  /** no charge for well over one interval: probably stopped */
  maybeStopped: boolean;
  /** first seen recently */
  isNew: boolean;
  /** the regular amount changed recently */
  priceChange: { fromCents: number; toCents: number; date: string } | null;
  /** occasional extra charges from the same merchant (e.g. a yearly fee), most recent first */
  oneOffs: { date: string; cents: number }[];
}

/** The same day N months later, kept within the month (Jan 31 + 1 month = Feb 28). */
function addMonthsToDate(iso: string, months: number, day?: number): string {
  const [year, month, originalDay] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day ?? originalDay, lastDay));
  return target.toISOString().slice(0, 10);
}

/** The next expected date after `date`. */
function step(date: string, item: Pick<Recurring, "frequency" | "daysOfMonth">): string {
  if (item.frequency === "semimonthly" && item.daysOfMonth) {
    const [first, second] = item.daysOfMonth;
    const day = Number(date.slice(8));
    // Closer to the first payday → the second one this month; otherwise the first one next month.
    return Math.abs(day - first) <= Math.abs(day - second)
      ? addMonthsToDate(date, 0, second)
      : addMonthsToDate(date, 1, first);
  }
  const rhythm = FREQUENCIES.find((candidate) => candidate.name === item.frequency)!;
  return rhythm.months ? addMonthsToDate(date, rhythm.months) : addDays(date, rhythm.days);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** How much amounts vary, relative to their typical size (0 = identical). */
function spread(amounts: number[]): number {
  const typical = median(amounts);
  if (typical === 0) return Infinity;
  return median(amounts.map((amount) => Math.abs(amount - typical))) / typical;
}

function mostCommon<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function isOneOff(cents: number, typical: number): boolean {
  return typical > 0 && Math.abs(cents - typical) / typical > ONE_OFF_RATIO;
}

/** Same-day charges are combined, so one bill paid in two pieces isn't read as two. */
function byDate(rows: Row[]): { date: string; cents: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.transaction_date, (totals.get(row.transaction_date) ?? 0) + Math.abs(toCents(row.amount)));
  return [...totals.entries()].map(([date, cents]) => ({ date, cents })).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Two fixed days each month (e.g. the 6th and 21st), allowing a few days'
 * shift for weekends and holidays. Every-two-weeks pay drifts through the
 * month instead, so it doesn't fit.
 */
function twiceMonthlyDays(dates: string[]): [number, number] | null {
  if (dates.length < 4) return null;
  const days = dates.map((date) => Number(date.slice(8))).sort((a, b) => a - b);
  let splitAt = 0;
  let widest = -1;
  for (let i = 1; i < days.length; i++) {
    if (days[i] - days[i - 1] > widest) {
      widest = days[i] - days[i - 1];
      splitAt = i;
    }
  }
  const early = days.slice(0, splitAt);
  const late = days.slice(splitAt);
  if (early.length < 2 || late.length < 2) return null;
  if (early[early.length - 1] - early[0] > 6 || late[late.length - 1] - late[0] > 6) return null;
  const first = Math.round(median(early));
  const second = Math.round(median(late));
  if (second - first < 10 || second - first > 20) return null;
  // At most two per month.
  const perMonth = new Map<string, number>();
  for (const date of dates) perMonth.set(date.slice(0, 7), (perMonth.get(date.slice(0, 7)) ?? 0) + 1);
  if ([...perMonth.values()].some((count) => count > 2)) return null;
  return [first, second];
}

/**
 * How many days the day-of-the-month moves around, treating the end and start
 * of a month as neighbors (a bill due on the 1st that lands on the 31st is
 * only a day early).
 */
function dayOfMonthSpread(dates: string[]): number {
  const days = dates.map((date) => Number(date.slice(8)));
  const center = median(days);
  const offsets = days.map((day) => {
    const offset = day - center;
    return offset > 15 ? offset - 30 : offset < -15 ? offset + 30 : offset;
  });
  return Math.max(...offsets) - Math.min(...offsets);
}

/**
 * Exactly one charge in each calendar month: three months in a row, or four or
 * more allowing one skipped month.
 */
function oncePerMonth(dates: string[]): boolean {
  if (dates.length < 3) return false;
  const months = dates.map((date) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)));
  if (new Set(months).size !== months.length) return false;
  const steps = months.slice(1).map((month, index) => month - months[index]);
  const skips = steps.filter((value) => value === 2).length;
  if (!steps.every((value) => value === 1 || value === 2)) return false;
  return skips === 0 || (skips === 1 && dates.length >= 4);
}

export interface DetectOptions {
  today: string;
  /** a charge first seen within this many days counts as new */
  newWithinDays?: number;
}

export function detectRecurring(rows: Row[], options: DetectOptions): Recurring[] {
  const { today, newWithinDays = 45 } = options;
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const kind = countsAsSpending(row) && row.amount < 0 ? "charge" : row.transaction_type === "income" ? "income" : null;
    if (!kind) continue;
    const key = `${row.normalized_merchant.trim().toLowerCase()}|${kind}|${row.person_id ?? "shared"}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const found: Recurring[] = [];
  for (const [key, items] of groups) {
    const all = byDate(items);
    if (all.length < 2) continue;
    // Set aside one-offs (a yearly fee, a lump payment) before looking for the rhythm.
    const typicalAll = median(all.map((event) => event.cents));
    const events = all.filter((event) => !isOneOff(event.cents, typicalAll));
    const oneOffs = all.filter((event) => isOneOff(event.cents, typicalAll)).reverse();
    // An occasional extra charge is fine; lots of "unusual" amounts means it isn't steady at all.
    if (events.length < 2 || oneOffs.length > Math.max(1, all.length * 0.25)) continue;

    const dates = events.map((event) => event.date);
    const gaps = events.slice(1).map((event, index) => daysBetween(events[index].date, event.date));
    const typicalGap = median(gaps);
    // Every-two-weeks schedules land exactly 14 days apart; twice-a-month ones don't (6th → 21st is 15).
    const exactlyBiweekly = gaps.filter((gap) => gap === 14).length / gaps.length >= 0.75;
    const daysOfMonth = exactlyBiweekly ? null : twiceMonthlyDays(dates);
    let frequency: Frequency;
    if (daysOfMonth) {
      frequency = "semimonthly";
    } else if (oncePerMonth(dates)) {
      // Paid on a different day each month, but every month (e.g. paid by hand).
      frequency = "monthly";
    } else {
      const rhythm = FREQUENCIES.find((candidate) => Math.abs(typicalGap - candidate.days) <= candidate.tolerance);
      if (!rhythm) continue;
      // Most gaps must fit the rhythm (one skipped or doubled period is fine).
      const fitting = gaps.filter((gap) => Math.abs(gap - rhythm.days) <= rhythm.tolerance * 1.5).length;
      if (fitting / gaps.length < 0.75) continue;
      frequency = rhythm.name;
    }
    const days = FREQUENCIES.find((candidate) => candidate.name === frequency)?.days ?? 15.2;

    const amounts = events.map((event) => event.cents);
    const amountSpread = spread(amounts);
    const isLongRhythm = days >= 85;
    // Two occurrences are enough only for long rhythms with near-identical amounts.
    if (events.length === 2 && !(isLongRhythm && amountSpread <= 0.05)) continue;
    // Frequent charges must be steady, or it's just a habit (coffee, groceries).
    if (amountSpread > (days < 25 ? 0.1 : 0.35)) continue;

    const last = events[events.length - 1];
    const kind = key.split("|")[1] as Recurring["kind"];
    const shape = { frequency, daysOfMonth };
    const nextDate = step(last.date, shape);
    const tolerance = FREQUENCIES.find((candidate) => candidate.name === frequency)?.tolerance ?? 3;
    const sample = items[items.length - 1];

    // A price change: the latest regular amount differs from what it usually was.
    const before = amounts.slice(-4, -1);
    const usual = before.length > 0 ? median(before) : last.cents;
    const changed = Math.abs(last.cents - usual) > Math.max(50, usual * 0.02);
    const annualCents = last.cents * PER_YEAR[frequency];

    found.push({
      key,
      merchant: sample.normalized_merchant,
      kind,
      personId: sample.person_id,
      categoryId: mostCommon(items.map((row) => row.category_id)),
      subcategoryId: mostCommon(items.map((row) => row.subcategory_id)),
      frequency,
      daysOfMonth,
      amountCents: last.cents,
      monthlyCents: Math.round(annualCents / 12),
      annualCents,
      count: events.length,
      firstDate: all[0].date,
      lastDate: last.date,
      nextDate,
      flexibleDay: (PER_YEAR[frequency] <= 12 && dayOfMonthSpread(dates) > FLEXIBLE_DAY_SPREAD) || false,
      confidence: events.length >= 3 && amountSpread <= 0.05 ? "high" : "medium",
      maybeStopped: daysBetween(nextDate, today) > Math.max(tolerance * 2, days * 0.5),
      isNew: daysBetween(all[0].date, today) <= newWithinDays,
      priceChange:
        kind === "charge" && changed && amountSpread <= 0.1
          ? { fromCents: Math.round(usual), toCents: last.cents, date: last.date }
          : null,
      oneOffs: oneOffs.slice(0, 3),
    });
  }
  return found.sort((a, b) => b.monthlyCents - a.monthlyCents);
}

/** Expected dates within the next `days`, for items still active. */
export function upcoming<T extends Recurring>(items: T[], today: string, days: number): { item: T; date: string }[] {
  const end = addDays(today, days);
  const result: { item: T; date: string }[] = [];
  for (const item of items) {
    if (item.maybeStopped) continue;
    let date = item.nextDate;
    // A slightly late charge is still expected; skip ones far in the past.
    for (let guard = 0; date < addDays(today, -7) && guard < 60; guard++) date = step(date, item);
    for (let guard = 0; date <= end && guard < 60; guard++) {
      result.push({ item, date });
      date = step(date, item);
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || b.item.amountCents - a.item.amountCents);
}
