import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  isISODate,
  isMonthKey,
  monthRange,
  todayInTimeZone,
  weekRange,
} from "@/lib/dates";
import { formatCents, formatSignedAmount, toCents } from "@/lib/money";

describe("dates", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("adds months across year boundaries", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("returns the first and last day of a month", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("supports Sunday–Saturday weeks", () => {
    const expected = { from: "2026-09-20", to: "2026-09-26" };
    expect(weekRange("2026-09-20", "sunday")).toEqual(expected); // Sunday
    expect(weekRange("2026-09-23", "sunday")).toEqual(expected); // Wednesday
    expect(weekRange("2026-09-26", "sunday")).toEqual(expected); // Saturday
    expect(weekRange("2026-09-27", "sunday").from).toBe("2026-09-27");
  });

  it("supports Monday–Sunday weeks", () => {
    const expected = { from: "2026-09-21", to: "2026-09-27" };
    expect(weekRange("2026-09-21", "monday")).toEqual(expected); // Monday
    expect(weekRange("2026-09-24", "monday")).toEqual(expected); // Thursday
    expect(weekRange("2026-09-27", "monday")).toEqual(expected); // Sunday
    expect(weekRange("2026-09-28", "monday").from).toBe("2026-09-28");
  });

  it("keeps a week together when it crosses a month", () => {
    expect(weekRange("2026-10-01", "sunday")).toEqual({ from: "2026-09-27", to: "2026-10-03" });
    expect(weekRange("2026-10-01", "monday")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("finds today in the household's time zone, not the server's", () => {
    const lateEveningEastern = new Date("2026-10-02T02:30:00Z");
    expect(todayInTimeZone("America/New_York", lateEveningEastern)).toBe("2026-10-01");
    expect(todayInTimeZone("UTC", lateEveningEastern)).toBe("2026-10-02");
  });

  it("validates date and month strings", () => {
    expect(isISODate("2026-10-01")).toBe(true);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("10/01/2026")).toBe(false);
    expect(isMonthKey("2026-10")).toBe(true);
    expect(isMonthKey("2026-00")).toBe(false);
    expect(isMonthKey("2026-10-01")).toBe(false);
  });
});

describe("money", () => {
  it("converts to cents without floating point drift", () => {
    expect(toCents(82.41)).toBe(8241);
    expect(toCents(-19.99)).toBe(-1999);
    expect(toCents(0.1) + toCents(0.2)).toBe(30);
  });

  it("formats totals and signed amounts", () => {
    expect(formatCents(284172)).toBe("$2,841.72");
    expect(formatSignedAmount(-82.41)).toBe("-$82.41");
    expect(formatSignedAmount(1500)).toBe("+$1,500.00");
    expect(formatSignedAmount(0)).toBe("$0.00");
  });
});
