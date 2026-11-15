import type { WeekStart } from "@/lib/dates";
import { addDays, addMonths, isMonthKey, monthKey, weekRange } from "@/lib/dates";
import { firstParam, type SearchParams } from "@/lib/params";
import { monthlyPeriods, weeklyPeriods, type ReportPeriod } from "./report";
import { parseView, viewParam } from "./view-param";
import type { View } from "./views";

export const MONTH_COUNTS = [3, 6, 12] as const;
export const WEEK_COUNTS = [4, 8, 13] as const;

export interface ReportOptions {
  view: View;
  period: "month" | "week";
  count: number;
  level: "category" | "subcategory";
  /** the last month shown ('YYYY-MM'), when one was chosen; otherwise the current period */
  end: string | null;
  /** leave out the current, unfinished period */
  completeOnly: boolean;
  periods: ReportPeriod[];
}

export function parseReportOptions(
  params: SearchParams,
  members: { id: string }[],
  today: string,
  weekStartsOn: WeekStart,
): ReportOptions {
  const period = firstParam(params.period) === "week" ? "week" : "month";
  const allowed: readonly number[] = period === "week" ? WEEK_COUNTS : MONTH_COUNTS;
  const requested = Number(firstParam(params.count));
  const count = allowed.includes(requested) ? requested : allowed[1];
  const level = firstParam(params.detail) === "subcategory" ? "subcategory" : "category";
  const completeOnly = firstParam(params.complete) === "1";
  const requestedEnd = firstParam(params.end) ?? "";
  const thisMonth = monthKey(today);
  const end = period === "month" && isMonthKey(requestedEnd) && requestedEnd < thisMonth ? requestedEnd : null;
  const lastMonth = end ?? (completeOnly ? addMonths(thisMonth, -1) : thisMonth);
  const lastWeekDay = completeOnly ? addDays(weekRange(today, weekStartsOn).from, -1) : today;
  return {
    view: parseView(firstParam(params.view), members),
    period,
    count,
    level,
    end,
    completeOnly,
    periods: period === "week" ? weeklyPeriods(lastWeekDay, count, weekStartsOn) : monthlyPeriods(lastMonth, count),
  };
}

/** Query values that reproduce these options (defaults left out). */
export function reportQuery(options: Omit<ReportOptions, "periods">): Record<string, string | number | undefined> {
  return {
    view: options.view.kind === "everyone" ? undefined : viewParam(options.view),
    period: options.period === "month" ? undefined : options.period,
    count: options.count,
    detail: options.level === "category" ? undefined : options.level,
    end: options.end ?? undefined,
    complete: options.completeOnly ? 1 : undefined,
  };
}
