// A month or a week, for pages that can show either.

import {
  addDays,
  addMonths,
  formatDay,
  formatDayWithYear,
  formatMonth,
  formatShortMonth,
  isISODate,
  isMonthKey,
  monthKey,
  monthRange,
  weekRange,
  type WeekStart,
} from "@/lib/dates";

export interface Period {
  kind: "month" | "week";
  /** 'YYYY-MM' for a month, the first day for a week */
  key: string;
  from: string;
  to: string;
}

export function monthPeriod(month: string): Period {
  return { kind: "month", key: month, ...monthRange(month) };
}

export function weekPeriod(date: string, startsOn: WeekStart): Period {
  const range = weekRange(date, startsOn);
  return { kind: "week", key: range.from, ...range };
}

/** Reads ?period=week&week=… or ?month=…, never going past today. */
export function parsePeriod(
  params: { period?: string; month?: string; week?: string },
  today: string,
  startsOn: WeekStart,
): Period {
  if (params.period === "week") {
    const date = params.week && isISODate(params.week) && params.week <= today ? params.week : today;
    return weekPeriod(date, startsOn);
  }
  const current = monthKey(today);
  const month = params.month && isMonthKey(params.month) && params.month <= current ? params.month : current;
  return monthPeriod(month);
}

export function shiftPeriod(period: Period, by: number, startsOn: WeekStart): Period {
  return period.kind === "month"
    ? monthPeriod(addMonths(period.key, by))
    : weekPeriod(addDays(period.key, by * 7), startsOn);
}

/** The `count` periods before this one, oldest first. */
export function earlierPeriods(period: Period, count: number, startsOn: WeekStart): Period[] {
  return Array.from({ length: count }, (_, index) => shiftPeriod(period, index - count, startsOn));
}

export function containsDate(period: Pick<Period, "from" | "to">, date: string): boolean {
  return date >= period.from && date <= period.to;
}

export function periodLabel(period: Period): string {
  return period.kind === "month" ? formatMonth(period.key) : `Week of ${formatDay(period.from)} – ${formatDayWithYear(period.to)}`;
}

export function periodShortLabel(period: Period): string {
  return period.kind === "month" ? formatShortMonth(period.key) : formatDay(period.from);
}

/** Query values for a period; the current month is the default and left out. */
export function periodQuery(period: Period, today: string): Record<string, string | undefined> {
  if (period.kind === "week") return { period: "week", week: period.key };
  return { month: period.key === monthKey(today) ? undefined : period.key };
}
