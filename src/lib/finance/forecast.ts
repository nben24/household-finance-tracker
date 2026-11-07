// Month forecasts from simple, explainable baselines (spec §26) and the
// month's cash flow (spec §32). No machine learning: every number traces back
// to history, recurring charges, or expected income.
//
//   projected spending = spent so far
//                      + recurring charges still to come (on their expected dates)
//                      + expected everyday spending for the rest of the month
//                      + expected irregular spending for the rest of the month

import { addDays, addMonths, daysBetween, monthRange } from "@/lib/dates";
import type { IncomeFrequency } from "@/lib/db/types";
import type { Entry, View } from "./views";

// ---------------------------------------------------------------------------
// Expected income schedules
// ---------------------------------------------------------------------------

export interface IncomeSchedule {
  frequency: IncomeFrequency;
  anchorDate: string;
  secondDay: number | null;
}

function dayInMonth(month: string, day: number): string {
  const last = Number(monthRange(month).to.slice(8));
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** Pay dates on a schedule between two dates (inclusive). */
export function scheduleDates(schedule: IncomeSchedule, from: string, to: string): string[] {
  const dates: string[] = [];
  if (schedule.frequency === "weekly" || schedule.frequency === "biweekly") {
    const step = schedule.frequency === "weekly" ? 7 : 14;
    const offset = ((daysBetween(schedule.anchorDate, from) % step) + step) % step;
    for (let date = offset === 0 ? from : addDays(from, step - offset); date <= to; date = addDays(date, step)) {
      dates.push(date);
    }
    return dates;
  }
  const days =
    schedule.frequency === "semimonthly" && schedule.secondDay
      ? [Number(schedule.anchorDate.slice(8)), schedule.secondDay]
      : [Number(schedule.anchorDate.slice(8))];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = addMonths(month, 1)) {
    for (const day of days) {
      const date = dayInMonth(month, day);
      if (date >= from && date <= to) dates.push(date);
    }
  }
  return dates.sort();
}

// ---------------------------------------------------------------------------
// The month forecast
// ---------------------------------------------------------------------------

export interface ExpectedItem {
  name: string;
  date: string;
  cents: number;
}

export interface ForecastInput {
  /** 'YYYY-MM': the current month or a later one */
  month: string;
  today: string;
  /** the household's earliest transaction: only months fully covered count as history */
  dataStartsOn: string | null;
  view: View;
  /** the view's entries, from at least six months before `month` through today */
  entries: Entry[];
  /** subcategories whose spending is irregular (gifts, medical, travel…) */
  irregularSubcategories: Set<string>;
  /** expected dates of recurring charges in the view (any range covering the month) */
  recurringCharges: ExpectedItem[];
  /** monthly cost of all active recurring charges in the view */
  recurringMonthlyCents: number;
  /** expected paydays in the view (any range covering the month) */
  income: ExpectedItem[];
}

export interface Range {
  expectedCents: number;
  lowCents: number;
  highCents: number;
}

export interface CategoryForecast {
  id: string | null;
  soFarCents: number;
  typicalCents: number;
  lowCents: number;
  highCents: number;
}

export interface Forecast {
  month: string;
  /** last day already reflected in actual numbers (the day before the month, for a future month) */
  cutoff: string;
  /** months of history the estimates are based on */
  historyMonths: number;
  spentSoFarCents: number;
  recurringToCome: ExpectedItem[];
  everyday: Range;
  irregularCents: number;
  spending: Range;
  incomeReceivedCents: number;
  incomeToCome: ExpectedItem[];
  incomeCents: number;
  /** person view: paid into the shared account; Shared view: paid in by both (counted as money in) */
  contributions: { soFarCents: number; toComeCents: number };
  /** already moved to savings or investments this month (only what's happened; future amounts are up to you) */
  setAsideSoFarCents: number;
  leftOver: Range;
  baselines: { historicalAverageCents: number; recentWeightedCents: number; detailedCents: number };
  byCategory: CategoryForecast[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function totals(entries: Entry[], from: string, to: string, kind: Entry["kind"], filter?: (entry: Entry) => boolean) {
  return Math.round(
    sum(
      entries
        .filter((entry) => entry.kind === kind && entry.date >= from && entry.date <= to && (!filter || filter(entry)))
        .map((entry) => entry.cents),
    ),
  );
}

export function forecastMonth(input: ForecastInput): Forecast {
  const { month, today, view, entries, irregularSubcategories } = input;
  const range = monthRange(month);
  const daysInMonth = Number(range.to.slice(8));
  const isCurrent = today >= range.from && today <= range.to;
  const cutoff = isCurrent ? today : addDays(range.from, -1);
  const daysElapsed = isCurrent ? Number(today.slice(8)) : 0;
  const remaining = (daysInMonth - daysElapsed) / daysInMonth;
  const isIrregular = (entry: Entry) => entry.subcategoryId !== null && irregularSubcategories.has(entry.subcategoryId);

  // History: up to six full months before this one that the data fully covers.
  const history = [6, 5, 4, 3, 2, 1]
    .map((back) => addMonths(month, -back))
    .filter((past) => past < today.slice(0, 7) && input.dataStartsOn !== null && input.dataStartsOn <= `${past}-01`)
    .map((past) => {
      const { from, to } = monthRange(past);
      const spending = totals(entries, from, to, "spending");
      const irregular = totals(entries, from, to, "spending", isIrregular);
      return {
        month: past,
        spending,
        irregular,
        everyday: Math.max(0, spending - irregular - input.recurringMonthlyCents),
        contributions: totals(entries, from, to, "contribution"),
      };
    });
  const recent = history.slice(-3);

  // So far this month.
  const spentSoFarCents = totals(entries, range.from, cutoff, "spending");
  const incomeReceivedCents = totals(entries, range.from, cutoff, "income");
  const contributedSoFar = totals(entries, range.from, cutoff, "contribution");
  const setAsideSoFarCents = totals(entries, range.from, cutoff, "saved") + totals(entries, range.from, cutoff, "invested");

  // Still to come.
  const later = (item: ExpectedItem) => item.date > cutoff && item.date <= range.to;
  const recurringToCome = input.recurringCharges.filter(later).sort((a, b) => a.date.localeCompare(b.date));
  const incomeToCome = input.income.filter(later).sort((a, b) => a.date.localeCompare(b.date));
  const recurringCents = sum(recurringToCome.map((item) => item.cents));

  const everydayMonths = recent.map((entry) => entry.everyday);
  const everyday: Range = {
    expectedCents: Math.round(median(everydayMonths) * remaining),
    lowCents: Math.round((everydayMonths.length ? Math.min(...everydayMonths) : 0) * remaining),
    highCents: Math.round((everydayMonths.length ? Math.max(...everydayMonths) : 0) * remaining),
  };
  const irregularCents = Math.round(
    (history.length ? sum(history.map((entry) => entry.irregular)) / history.length : 0) * remaining,
  );

  const fixedPart = spentSoFarCents + recurringCents + irregularCents;
  const spending: Range = {
    expectedCents: fixedPart + everyday.expectedCents,
    lowCents: fixedPart + everyday.lowCents,
    highCents: fixedPart + everyday.highCents,
  };

  const incomeCents = incomeReceivedCents + sum(incomeToCome.map((item) => item.cents));
  const typicalContribution = median(recent.map((entry) => entry.contributions));
  const contributions = {
    soFarCents: contributedSoFar,
    toComeCents: view.kind === "everyone" ? 0 : Math.max(0, typicalContribution - contributedSoFar),
  };
  const contributionTotal = contributions.soFarCents + contributions.toComeCents;
  const moneyIn = incomeCents + (view.kind === "shared" ? contributionTotal : 0);
  const moneyOut = (view.kind === "person" ? contributionTotal : 0) + setAsideSoFarCents;
  const leftOver: Range = {
    expectedCents: moneyIn - moneyOut - spending.expectedCents,
    // more spending means less left over
    lowCents: moneyIn - moneyOut - spending.highCents,
    highCents: moneyIn - moneyOut - spending.lowCents,
  };

  // The three baselines, as whole-month totals.
  const weights = [1, 2, 3].slice(-recent.length);
  const historicalAverageCents = history.length ? Math.round(sum(history.map((entry) => entry.spending)) / history.length) : 0;
  const recentWeightedCents = recent.length
    ? Math.round(sum(recent.map((entry, index) => entry.spending * weights[index])) / sum(weights))
    : 0;

  // By category: so far, a typical month, and the range of recent months.
  const ids = new Set<string | null>();
  for (const entry of entries) {
    if (entry.kind === "spending" && entry.date >= (recent[0] ? `${recent[0].month}-01` : range.from) && entry.date <= cutoff) {
      ids.add(entry.categoryId);
    }
  }
  const byCategory = [...ids]
    .map((id) => {
      const inCategory = (entry: Entry) => entry.categoryId === id;
      const months = recent.map((entry) => {
        const { from, to } = monthRange(entry.month);
        return totals(entries, from, to, "spending", inCategory);
      });
      return {
        id,
        soFarCents: totals(entries, range.from, cutoff, "spending", inCategory),
        typicalCents: median(months),
        lowCents: months.length ? Math.min(...months) : 0,
        highCents: months.length ? Math.max(...months) : 0,
      };
    })
    .filter((category) => category.soFarCents !== 0 || category.typicalCents !== 0)
    .sort((a, b) => Math.max(b.typicalCents, b.soFarCents) - Math.max(a.typicalCents, a.soFarCents));

  return {
    month,
    cutoff,
    historyMonths: history.length,
    spentSoFarCents,
    recurringToCome,
    everyday,
    irregularCents,
    spending,
    incomeReceivedCents,
    incomeToCome,
    incomeCents,
    contributions,
    setAsideSoFarCents,
    leftOver,
    baselines: { historicalAverageCents, recentWeightedCents, detailedCents: spending.expectedCents },
    byCategory,
  };
}
