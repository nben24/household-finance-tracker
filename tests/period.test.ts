import { describe, expect, it } from "vitest";
import {
  containsDate,
  earlierPeriods,
  parsePeriod,
  periodLabel,
  periodQuery,
  periodShortLabel,
  shiftPeriod,
} from "@/lib/finance/period";
import { averageByCategory, viewEntries } from "@/lib/finance/views";

const today = "2026-10-03"; // a Saturday

describe("periods", () => {
  it("defaults to the current month, and the current week when asked for weeks", () => {
    expect(parsePeriod({}, today, "sunday")).toEqual({ kind: "month", key: "2026-10", from: "2026-10-01", to: "2026-10-31" });
    expect(parsePeriod({ period: "week" }, today, "sunday")).toEqual({
      kind: "week",
      key: "2026-09-27",
      from: "2026-09-27",
      to: "2026-10-03",
    });
  });

  it("snaps any date to the start of its week, and respects the week-start setting", () => {
    expect(parsePeriod({ period: "week", week: "2026-09-23" }, today, "sunday").from).toBe("2026-09-20");
    expect(parsePeriod({ period: "week", week: "2026-09-23" }, today, "monday").from).toBe("2026-09-21");
  });

  it("ignores the future and nonsense", () => {
    expect(parsePeriod({ month: "2027-01" }, today, "sunday").key).toBe("2026-10");
    expect(parsePeriod({ month: "nope" }, today, "sunday").key).toBe("2026-10");
    expect(parsePeriod({ period: "week", week: "2026-12-01" }, today, "sunday").key).toBe("2026-09-27");
  });

  it("steps backwards and forwards across month and year boundaries", () => {
    const week = parsePeriod({ period: "week" }, today, "sunday");
    expect(shiftPeriod(week, -1, "sunday").from).toBe("2026-09-20");
    expect(shiftPeriod(parsePeriod({ month: "2026-01" }, today, "sunday"), -1, "sunday").key).toBe("2025-12");
    expect(earlierPeriods(week, 3, "sunday").map((p) => p.from)).toEqual(["2026-09-06", "2026-09-13", "2026-09-20"]);
  });

  it("labels and links periods", () => {
    const week = parsePeriod({ period: "week" }, today, "sunday");
    expect(periodLabel(week)).toBe("Week of Sep 27 – Oct 3, 2026");
    expect(periodShortLabel(week)).toBe("Sep 27");
    expect(periodQuery(week, today)).toEqual({ period: "week", week: "2026-09-27" });
    expect(periodQuery(parsePeriod({}, today, "sunday"), today)).toEqual({ month: undefined });
    expect(periodQuery(parsePeriod({ month: "2026-08" }, today, "sunday"), today)).toEqual({ month: "2026-08" });
    expect(containsDate(week, "2026-10-01")).toBe(true);
    expect(containsDate(week, "2026-10-04")).toBe(false);
  });
});

describe("weekly averages", () => {
  it("averages each category over the given weeks", () => {
    const row = (date: string, amount: number) => ({
      transaction_date: date,
      amount: -amount,
      transaction_type: "expense" as const,
      person_id: "n",
      counterparty_id: null,
      category_id: "food",
      subcategory_id: null,
    });
    const entries = viewEntries([row("2026-09-14", 100), row("2026-09-22", 60), row("2026-09-30", 999)], { kind: "everyone" }, { memberCount: 2, mode: "separate" });
    const weeks = [
      { from: "2026-09-13", to: "2026-09-19" },
      { from: "2026-09-20", to: "2026-09-26" },
    ];
    expect(averageByCategory(entries, [{ id: "food", name: "Food" }], weeks).get("food")).toBe(8000);
  });
});
