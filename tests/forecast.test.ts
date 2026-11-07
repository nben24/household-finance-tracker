import { describe, expect, it } from "vitest";
import { forecastMonth, scheduleDates, type ForecastInput } from "@/lib/finance/forecast";
import type { Entry } from "@/lib/finance/views";

describe("pay schedules", () => {
  it("twice a month on set days, kept within short months", () => {
    expect(scheduleDates({ frequency: "semimonthly", anchorDate: "2026-09-06", secondDay: 21 }, "2026-10-01", "2026-11-30")).toEqual([
      "2026-10-06",
      "2026-10-21",
      "2026-11-06",
      "2026-11-21",
    ]);
    expect(scheduleDates({ frequency: "semimonthly", anchorDate: "2026-01-15", secondDay: 31 }, "2027-02-01", "2027-02-28")).toEqual([
      "2027-02-15",
      "2027-02-28",
    ]);
  });

  it("every two weeks from any known payday, before or after the range", () => {
    const later = scheduleDates({ frequency: "biweekly", anchorDate: "2026-12-04", secondDay: null }, "2026-10-01", "2026-10-31");
    const earlier = scheduleDates({ frequency: "biweekly", anchorDate: "2026-01-02", secondDay: null }, "2026-10-01", "2026-10-31");
    expect(later).toEqual(["2026-10-09", "2026-10-23"]);
    expect(earlier).toEqual(later);
  });

  it("weekly and monthly", () => {
    expect(scheduleDates({ frequency: "weekly", anchorDate: "2026-10-02", secondDay: null }, "2026-10-01", "2026-10-20")).toEqual([
      "2026-10-02",
      "2026-10-09",
      "2026-10-16",
    ]);
    expect(scheduleDates({ frequency: "monthly", anchorDate: "2026-01-31", secondDay: null }, "2026-09-01", "2026-10-31")).toEqual([
      "2026-09-30",
      "2026-10-31",
    ]);
  });
});

const spend = (date: string, dollars: number, subcategoryId: string | null = "groceries", categoryId = "food"): Entry => ({
  date,
  cents: dollars * 100,
  kind: "spending",
  categoryId,
  subcategoryId,
});
const income = (date: string, dollars: number): Entry => ({ date, cents: dollars * 100, kind: "income", categoryId: null, subcategoryId: null });
const contribution = (date: string, dollars: number): Entry => ({ date, cents: dollars * 100, kind: "contribution", categoryId: null, subcategoryId: null, personId: "n" });

// Three full months of history (Jul–Sep) and October so far (through the 10th).
const history: Entry[] = [
  // each month: $500 of recurring bills, everyday spending of 1000 / 1400 / 1200, irregular 0 / 300 / 0
  ...["07", "08", "09"].flatMap((m, i) => [
    spend(`2026-${m}-01`, 500, "mortgage", "housing"),
    spend(`2026-${m}-15`, [1000, 1400, 1200][i]),
    ...(i === 1 ? [spend(`2026-${m}-20`, 300, "gifts", "gifts")] : []),
    income(`2026-${m}-06`, 2400),
    income(`2026-${m}-21`, 2400),
    contribution(`2026-${m}-07`, 1150),
    contribution(`2026-${m}-22`, 1150),
  ]),
  spend("2026-10-01", 500, "mortgage", "housing"),
  spend("2026-10-05", 300),
  income("2026-10-06", 2400),
  contribution("2026-10-07", 1150),
];

const input = (overrides: Partial<ForecastInput> = {}): ForecastInput => ({
  month: "2026-10",
  today: "2026-10-10",
  dataStartsOn: "2026-07-01",
  view: { kind: "person", personId: "n" },
  entries: history,
  irregularSubcategories: new Set(["gifts"]),
  recurringCharges: [
    { name: "Netflix", date: "2026-10-07", cents: 2000 }, // already happened
    { name: "Insurance", date: "2026-10-14", cents: 8500 },
    { name: "Mortgage", date: "2026-11-01", cents: 50000 }, // next month
  ],
  recurringMonthlyCents: 50000,
  income: [
    { name: "Paycheck", date: "2026-10-06", cents: 240000 },
    { name: "Paycheck", date: "2026-10-21", cents: 240000 },
  ],
  ...overrides,
});

describe("forecasting the month", () => {
  const f = forecastMonth(input());
  const remaining = 21 / 31;

  it("adds what's already spent to bills still to come and usual spending for the rest of the month", () => {
    expect(f.historyMonths).toBe(3);
    expect(f.spentSoFarCents).toBe(80000);
    expect(f.recurringToCome).toEqual([{ name: "Insurance", date: "2026-10-14", cents: 8500 }]);
    // typical everyday month = middle of 1000, 1400, 1200 (after taking out $500 of bills and irregular spending)
    expect(f.everyday.expectedCents).toBe(Math.round(120000 * remaining));
    expect(f.everyday.lowCents).toBe(Math.round(100000 * remaining));
    expect(f.everyday.highCents).toBe(Math.round(140000 * remaining));
    // irregular: $300 once in three months → $100 a month, for the rest of the month
    expect(f.irregularCents).toBe(Math.round(10000 * remaining));
    expect(f.spending.expectedCents).toBe(80000 + 8500 + f.irregularCents + f.everyday.expectedCents);
  });

  it("counts income received and paydays still to come, without double counting", () => {
    expect(f.incomeReceivedCents).toBe(240000);
    expect(f.incomeToCome.map((item) => item.date)).toEqual(["2026-10-21"]);
    expect(f.incomeCents).toBe(480000);
  });

  it("for a person, sets aside what they usually pay into the shared account", () => {
    expect(f.contributions).toEqual({ soFarCents: 115000, toComeCents: 115000 });
    expect(f.leftOver.expectedCents).toBe(480000 - 230000 - f.spending.expectedCents);
    expect(f.leftOver.lowCents).toBeLessThan(f.leftOver.expectedCents);
    expect(f.leftOver.highCents).toBeGreaterThan(f.leftOver.expectedCents);
  });

  it("compares three baselines", () => {
    // whole months: 1500, 2200, 1700
    expect(f.baselines.historicalAverageCents).toBe(180000);
    expect(f.baselines.recentWeightedCents).toBe(Math.round((150000 * 1 + 220000 * 2 + 170000 * 3) / 6));
    expect(f.baselines.detailedCents).toBe(f.spending.expectedCents);
  });

  it("breaks it down by category", () => {
    const food = f.byCategory.find((category) => category.id === "food")!;
    expect(food).toEqual({ id: "food", soFarCents: 30000, typicalCents: 120000, lowCents: 100000, highCents: 140000 });
  });

  it("forecasts next month from scratch", () => {
    const next = forecastMonth(input({ month: "2026-11" }));
    expect(next.spentSoFarCents).toBe(0);
    expect(next.recurringToCome.map((item) => item.name)).toEqual(["Mortgage"]);
    expect(next.everyday.expectedCents).toBe(120000);
    expect(next.contributions.toComeCents).toBe(230000);
  });

  it("works without history, using only what's known", () => {
    const fresh = forecastMonth(input({ dataStartsOn: "2026-10-01" }));
    expect(fresh.historyMonths).toBe(0);
    expect(fresh.everyday.expectedCents).toBe(0);
    expect(fresh.spending.expectedCents).toBe(80000 + 8500);
  });

  it("for the shared account, counts both people's deposits as money in", () => {
    const shared = forecastMonth(input({ view: { kind: "shared" } }));
    expect(shared.leftOver.expectedCents).toBe(480000 + 230000 - shared.spending.expectedCents);
    const everyone = forecastMonth(input({ view: { kind: "everyone" } }));
    expect(everyone.contributions.toComeCents).toBe(0);
    expect(everyone.leftOver.expectedCents).toBe(480000 - everyone.spending.expectedCents);
  });
});

describe("money set aside", () => {
  it("takes what's already gone to savings or investments out of what's left over", () => {
    const saved: Entry = { date: "2026-10-06", cents: 60000, kind: "saved", categoryId: null, subcategoryId: null };
    const invested: Entry = { date: "2026-10-06", cents: 25000, kind: "invested", categoryId: null, subcategoryId: null };
    const before = forecastMonth(input());
    const after = forecastMonth(input({ entries: [...history, saved, invested] }));
    expect(after.setAsideSoFarCents).toBe(85000);
    expect(after.leftOver.expectedCents).toBe(before.leftOver.expectedCents - 85000);
  });
});
