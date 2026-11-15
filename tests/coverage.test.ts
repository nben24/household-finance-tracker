import { describe, expect, it } from "vitest";
import { accountCovers, coverageSummary, gapsIn, mergedRanges, monthIsComplete, requiredAccounts } from "@/lib/finance/coverage";
import { householdToday } from "@/lib/household-time";
import { shareOf } from "@/lib/finance/views";
import { budgetStatus, findConflict } from "@/lib/finance/budgets";

const account = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  account_type: "checking" as const,
  institution: "Bank",
  is_active: true,
  closed_on: null as string | null,
  ...overrides,
});
const period = (account_id: string, covered_from: string, covered_through: string, source: "import" | "estimated" = "import") => ({
  account_id,
  covered_from,
  covered_through,
  source,
});

describe("account coverage", () => {
  it("joins touching and overlapping imports into continuous stretches", () => {
    const periods = [period("a", "2026-07-01", "2026-07-31"), period("a", "2026-08-01", "2026-08-20"), period("a", "2026-08-10", "2026-09-05")];
    expect(mergedRanges(periods, "a")).toEqual([{ from: "2026-07-01", through: "2026-09-05", estimated: false }]);
    expect(accountCovers(periods, "a", "2026-07-15", "2026-09-01")).toBe(true);
    expect(accountCovers(periods, "a", "2026-07-15", "2026-09-06")).toBe(false);
  });

  it("finds gaps between imports", () => {
    const periods = [period("a", "2026-07-01", "2026-07-10"), period("a", "2026-07-20", "2026-07-31")];
    expect(gapsIn(periods, "a", "2026-07-01", "2026-07-31")).toEqual([{ from: "2026-07-11", to: "2026-07-19" }]);
    expect(gapsIn([], "a", "2026-07-01", "2026-07-31")).toEqual([{ from: "2026-07-01", to: "2026-07-31" }]);
  });

  it("doesn't treat the earliest transaction as proof every account is covered", () => {
    // Checking imported since July, the card only since September.
    const accounts = [account("checking"), account("card", { account_type: "credit_card" })];
    const periods = [period("checking", "2026-07-01", "2026-10-31"), period("card", "2026-09-01", "2026-10-31")];
    expect(monthIsComplete(accounts, periods, "2026-07")).toBe(false);
    expect(monthIsComplete(accounts, periods, "2026-08")).toBe(false);
    expect(monthIsComplete(accounts, periods, "2026-09")).toBe(true);
  });

  it("ignores accounts that are never imported, cash, and ones retired before the month", () => {
    const accounts = [
      account("checking"),
      account("brokerage", { account_type: "brokerage" }), // net worth only, never imported
      account("cash", { institution: "Cash", account_type: "other" }),
      account("old", { is_active: false, closed_on: "2026-08-01" }),
    ];
    const periods = [period("checking", "2026-07-01", "2026-10-31"), period("old", "2026-07-01", "2026-07-31")];
    expect(requiredAccounts(accounts, periods, "2026-07-01").map((a) => a.id)).toEqual(["checking", "old"]);
    expect(monthIsComplete(accounts, periods, "2026-07")).toBe(true);
    // The old account closed August 1, so August only needs checking.
    expect(monthIsComplete(accounts, periods, "2026-08")).toBe(true);
  });

  it("summarizes how up to date each account is", () => {
    const accounts = [account("a"), account("b"), account("c"), account("d"), account("never")];
    const periods = [
      period("a", "2026-07-01", "2026-11-13"),
      period("b", "2026-07-01", "2026-11-13"),
      period("c", "2026-07-01", "2026-11-13"),
      period("d", "2026-07-01", "2026-10-31", "estimated"),
    ];
    const summary = coverageSummary(accounts, periods);
    expect(summary).toMatchObject({ latest: "2026-11-13", upToDate: 3, total: 4 });
    expect(summary.accounts.find((s) => s.accountId === "d")).toEqual({ accountId: "d", through: "2026-10-31", estimated: true });
    expect(summary.accounts.find((s) => s.accountId === "never")).toEqual({ accountId: "never", through: null, estimated: false });
  });
});

describe("the household calendar", () => {
  const ny = { time_zone: "America/New_York" };

  it("changes date at local midnight, not UTC midnight", () => {
    expect(householdToday(ny, new Date("2026-11-14T04:59:59Z"))).toBe("2026-11-13"); // 11:59:59 pm in New York
    expect(householdToday(ny, new Date("2026-11-14T05:00:00Z"))).toBe("2026-11-14"); // midnight
  });

  it("follows daylight saving time", () => {
    // Spring forward (March 8, 2026): New York is UTC−5 until 2 am.
    expect(householdToday(ny, new Date("2026-03-08T04:59:59Z"))).toBe("2026-03-07");
    expect(householdToday(ny, new Date("2026-03-08T05:00:00Z"))).toBe("2026-03-08");
    // Fall back (November 1, 2026): midnight is still UTC−4.
    expect(householdToday(ny, new Date("2026-11-01T03:59:59Z"))).toBe("2026-10-31");
    expect(householdToday(ny, new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
  });

  it("uses the stored zone, falling back to the app setting for an unknown one", () => {
    const at = new Date("2026-11-14T03:00:00Z");
    expect(householdToday({ time_zone: "America/Los_Angeles" }, at)).toBe("2026-11-13");
    expect(householdToday({ time_zone: "Asia/Tokyo" }, at)).toBe("2026-11-14");
    expect(householdToday({ time_zone: "Not/AZone" }, at)).toBe(householdToday(null, at));
  });
});

describe("dividing shared spending in whole cents", () => {
  it("always adds back up to the exact amount", () => {
    for (const cents of [1001, 1000, 1, -1001, 0, 99_999, 7]) {
      for (const count of [1, 2, 3]) {
        const shares = Array.from({ length: count }, (_, index) => shareOf(cents, count, index));
        expect(shares.reduce((a, b) => a + b, 0)).toBe(cents);
        expect(shares.every((share) => Number.isInteger(share))).toBe(true);
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("budget conflicts", () => {
  const line = (scope: "everyone" | "person" | "shared", person_id: string | null, subcategory_id: string | null = null) => ({
    id: `${scope}-${person_id}-${subcategory_id}`,
    scope,
    person_id,
    category_id: "food",
    subcategory_id,
  });

  it("names the line that already counts the spending", () => {
    const household = line("everyone", null);
    expect(findConflict(line("person", "n"), [household])).toBe(household);
    expect(findConflict(line("person", "n", "groceries"), [line("person", "n")])).not.toBeNull();
    expect(findConflict(line("person", "n"), [line("person", "m")])).toBeNull();
  });

  it("treats a personal and a shared line for one category as double counting only in split mode", () => {
    expect(findConflict(line("person", "n"), [line("shared", null)], "separate")).toBeNull();
    expect(findConflict(line("person", "n"), [line("shared", null)], "split")).not.toBeNull();
    expect(findConflict(line("shared", null), [line("person", "m")], "split")).not.toBeNull();
  });
});

describe("budget states", () => {
  const money = (cents: number) => `$${cents / 100}`;
  const progress = (kind: "variable" | "fixed" | "allowance", budgetCents: number, spentCents: number) => ({
    line: { kind },
    budgetCents,
    spentCents,
    remainingCents: budgetCents - spentCents,
  });

  it("shows everyday spending within budget, and over budget in amber with the overage", () => {
    expect(budgetStatus(progress("variable", 45000, 20000), money)).toMatchObject({ tone: "normal", over: false, text: "$250 left" });
    expect(budgetStatus(progress("variable", 45000, 65200), money)).toMatchObject({
      tone: "over",
      over: true,
      text: "$202 over budget",
    });
  });

  it("never says a fixed bill was paid; it says what was charged", () => {
    expect(budgetStatus(progress("fixed", 245000, 245000), money)).toMatchObject({ tone: "fixed", text: "Charged the budgeted amount" });
    expect(budgetStatus(progress("fixed", 245000, 0), money)).toMatchObject({ tone: "fixed", text: "Not charged yet this month" });
    expect(budgetStatus(progress("fixed", 245000, 250000), money)).toMatchObject({ tone: "over", over: true });
    expect(JSON.stringify(budgetStatus(progress("fixed", 245000, 245000), money))).not.toMatch(/paid/i);
  });
});
