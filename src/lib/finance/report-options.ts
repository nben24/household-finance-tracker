import type { WeekStart } from "@/lib/dates";
import { monthKey } from "@/lib/dates";
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
  return {
    view: parseView(firstParam(params.view), members),
    period,
    count,
    level,
    periods: period === "week" ? weeklyPeriods(today, count, weekStartsOn) : monthlyPeriods(monthKey(today), count),
  };
}

/** Query values that reproduce these options (defaults left out). */
export function reportQuery(options: Omit<ReportOptions, "periods">): Record<string, string | number | undefined> {
  return {
    view: options.view.kind === "everyone" ? undefined : viewParam(options.view),
    period: options.period === "month" ? undefined : options.period,
    count: options.count,
    detail: options.level === "category" ? undefined : options.level,
  };
}
