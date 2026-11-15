import "server-only";
import { cache } from "react";
import { getDataSource } from "@/lib/data";
import { addMonths, monthRange } from "@/lib/dates";
import type { AccountCoverageRow, AccountRow } from "@/lib/db/types";
import { coverageSummary, monthIsComplete, rangeIsComplete, requiredAccounts, type CoverageSummary } from "./coverage";

export interface CoverageInfo {
  accounts: AccountRow[];
  periods: AccountCoverageRow[];
  summary: CoverageSummary;
  isMonthComplete: (month: string) => boolean;
  isRangeComplete: (from: string, to: string) => boolean;
  /** of the given months, those that aren't complete although some of their activity was imported */
  partialAmong: (months: string[]) => string[];
}

/** The household's coverage, loaded once per request. */
export const loadCoverage = cache(async (householdId: string): Promise<CoverageInfo> => {
  const data = getDataSource();
  const [accounts, periods] = await Promise.all([data.listAccounts(householdId), data.listCoverage(householdId)]);
  const firstCovered = periods.reduce<string | null>(
    (min, period) => (!min || period.covered_from < min ? period.covered_from : min),
    null,
  );
  const isMonthComplete = (month: string) => monthIsComplete(accounts, periods, month);
  return {
    accounts,
    periods,
    summary: coverageSummary(accounts, periods),
    isMonthComplete,
    isRangeComplete: (from, to) => rangeIsComplete(accounts, periods, from, to),
    partialAmong: (months) =>
      months.filter((month) => {
        const { to } = monthRange(month);
        return (
          firstCovered !== null &&
          firstCovered <= to &&
          requiredAccounts(accounts, periods, monthRange(month).from).length > 0 &&
          !isMonthComplete(month)
        );
      }),
  };
});

/** The `count` months before `month`, oldest first. */
export function monthsBefore(month: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addMonths(month, index - count));
}
