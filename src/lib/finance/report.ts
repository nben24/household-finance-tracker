// Spreadsheet-style report: categories down the side, months or weeks across.

import { addDays, addMonths, formatDay, formatShortMonth, monthRange, weekRange, type WeekStart } from "@/lib/dates";
import type { CategoryRow } from "@/lib/db/types";
import { entriesByCategory, viewTotals, type Entry, type View } from "./views";

export interface ReportPeriod {
  label: string;
  from: string;
  to: string;
}

export function monthlyPeriods(lastMonth: string, count: number): ReportPeriod[] {
  return Array.from({ length: count }, (_, index) => {
    const month = addMonths(lastMonth, index - (count - 1));
    const sameYear = month.slice(0, 4) === lastMonth.slice(0, 4);
    const label = sameYear ? formatShortMonth(month) : `${formatShortMonth(month)} ’${month.slice(2, 4)}`;
    return { label, ...monthRange(month) };
  });
}

export function weeklyPeriods(lastDate: string, count: number, startsOn: WeekStart): ReportPeriod[] {
  const last = weekRange(lastDate, startsOn);
  return Array.from({ length: count }, (_, index) => {
    const from = addDays(last.from, (index - (count - 1)) * 7);
    return { label: formatDay(from), from, to: addDays(from, 6) };
  });
}

export interface ReportRow {
  id: string | null;
  name: string;
  cells: number[];
  total: number;
}

export interface Report {
  rows: ReportRow[];
  spending: number[];
  income: number[];
  contributions: number[];
  setAside: number[];
  net: number[];
}

export function buildReport(
  entries: Entry[],
  periods: ReportPeriod[],
  categories: Pick<CategoryRow, "id" | "name">[],
  level: "category" | "subcategory",
  view: View,
): Report {
  const inPeriod = periods.map((period) =>
    entries.filter((entry) => entry.date >= period.from && entry.date <= period.to),
  );
  const rowsById = new Map<string | null, ReportRow>();
  inPeriod.forEach((periodEntries, index) => {
    for (const total of entriesByCategory(periodEntries, categories, level)) {
      const row = rowsById.get(total.id) ?? { id: total.id, name: total.name, cells: periods.map(() => 0), total: 0 };
      row.cells[index] = total.cents;
      row.total += total.cents;
      rowsById.set(total.id, row);
    }
  });
  const totals = inPeriod.map((periodEntries) => viewTotals(periodEntries, view));
  return {
    rows: [...rowsById.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    spending: totals.map((t) => t.spendingCents),
    income: totals.map((t) => t.incomeCents),
    contributions: totals.map((t) => t.contributionCents),
    setAside: totals.map((t) => t.savedCents + t.investedCents),
    net: totals.map((t) => t.netCents),
  };
}

/**
 * A cell safe to open in a spreadsheet: text that starts with = + - @ or a
 * control character is prefixed with ' so it is never run as a formula.
 */
export function csvCell(value: string | number): string {
  if (typeof value === "number") return (value / 100).toFixed(2);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function reportToCsv(report: Report, periods: ReportPeriod[], showContributions: boolean): string {
  const line = (cells: (string | number)[]) => cells.map(csvCell).join(",");
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const lines = [
    line(["Category", ...periods.map((p) => `${p.from} to ${p.to}`), "Total"]),
    ...report.rows.map((row) => line([row.name, ...row.cells, row.total])),
    line(["Total spending", ...report.spending, sum(report.spending)]),
    line(["Income", ...report.income, sum(report.income)]),
    ...(showContributions ? [line(["Paid into shared", ...report.contributions, sum(report.contributions)])] : []),
    line(["Saved & invested", ...report.setAside, sum(report.setAside)]),
    line(["Left over", ...report.net, sum(report.net)]),
  ];
  return lines.join("\r\n") + "\r\n";
}
