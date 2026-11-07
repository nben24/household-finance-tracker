import { describe, expect, it } from "vitest";
import type { BudgetLineRow } from "@/lib/db/types";
import {
  activeIn,
  budgetProgress,
  budgetTotals,
  conflictsWith,
  covers,
  linesForView,
  scopeOf,
  suggestedKind,
  tidyAmount,
  unbudgetedCents,
  viewOfLine,
} from "@/lib/finance/budgets";
import { viewEntries, type View } from "@/lib/finance/views";
import { generateSeedData } from "@/lib/seed/generate";

type Line = BudgetLineRow;
let next = 0;
function line(overrides: Partial<Line>): Line {
  next += 1;
  return {
    id: `line-${next}`,
    household_id: "h",
    scope: "everyone",
    person_id: null,
    category_id: "food",
    subcategory_id: null,
    kind: "variable",
    amount: 100,
    starts_month: "2026-01-01",
    ends_month: null,
    created_at: "",
    ...overrides,
  };
}

type Row = Parameters<typeof viewEntries>[0][number];
const spend = (date: string, amount: number, overrides: Partial<Row> = {}): Row => ({
  transaction_date: date,
  amount: -amount,
  transaction_type: "expense",
  person_id: "n",
  counterparty_id: null,
  category_id: "food",
  subcategory_id: "groceries",
  ...overrides,
});
const options = { memberCount: 2, mode: "separate" as const };
const everyone: View = { kind: "everyone" };
const entriesOf = (rows: Row[]) => () => viewEntries(rows, everyone, options);

describe("which budget lines apply", () => {
  it("knows when a line is in effect", () => {
    const old = line({ starts_month: "2026-01-01", ends_month: "2026-08-01" });
    const current = line({ starts_month: "2026-09-01" });
    expect(activeIn([old, current], "2026-08").map((l) => l.id)).toEqual([old.id]);
    expect(activeIn([old, current], "2026-09").map((l) => l.id)).toEqual([current.id]);
    expect(activeIn([old, current], "2025-12")).toEqual([]);
  });

  it("shows the whole household plan to Everyone, and only their own to a person or Shared", () => {
    const household = line({});
    const john = line({ scope: "person", person_id: "n" });
    const jane = line({ scope: "person", person_id: "m" });
    const shared = line({ scope: "shared" });
    const all = [household, john, jane, shared];
    expect(linesForView(all, everyone)).toHaveLength(4);
    expect(linesForView(all, { kind: "person", personId: "n" })).toEqual([john]);
    expect(linesForView(all, { kind: "shared" })).toEqual([shared]);
    expect(viewOfLine(john)).toEqual({ kind: "person", personId: "n" });
    expect(scopeOf({ kind: "person", personId: "m" })).toEqual({ scope: "person", person_id: "m" });
  });

  it("matches spending to a whole category or one subcategory", () => {
    const entry = { categoryId: "food", subcategoryId: "groceries" };
    expect(covers({ category_id: "food", subcategory_id: null }, entry)).toBe(true);
    expect(covers({ category_id: "food", subcategory_id: "groceries" }, entry)).toBe(true);
    expect(covers({ category_id: "food", subcategory_id: "coffee" }, entry)).toBe(false);
  });

  it("refuses two budgets that would count the same spending", () => {
    const groceries = { scope: "everyone" as const, person_id: null, category_id: "food", subcategory_id: "groceries" };
    const wholeFood = { ...groceries, subcategory_id: null };
    const coffee = { ...groceries, subcategory_id: "coffee" };
    expect(conflictsWith(wholeFood, [groceries])).toBe(true);
    expect(conflictsWith(coffee, [groceries])).toBe(false);
    // household-wide and personal budgets for the same category would double count
    const johnGroceries = { ...groceries, scope: "person" as const, person_id: "n" };
    expect(conflictsWith(johnGroceries, [groceries])).toBe(true);
    // but each person can have their own play money
    const johnPlay = { scope: "person" as const, person_id: "n", category_id: "personal", subcategory_id: "play" };
    const janePlay = { ...johnPlay, person_id: "m" };
    expect(conflictsWith(janePlay, [johnPlay])).toBe(false);
  });
});

describe("budget progress", () => {
  it("compares this month's spending with the budget", () => {
    const groceries = line({ subcategory_id: "groceries", amount: 800 });
    const rows = [spend("2026-09-03", 300), spend("2026-09-20", 200), spend("2026-08-20", 999), spend("2026-09-21", 50, { subcategory_id: "coffee" })];
    const [progress] = budgetProgress([groceries], entriesOf(rows), "2026-09");
    expect(progress).toMatchObject({ budgetCents: 80000, spentCents: 50000, remainingCents: 30000 });
  });

  it("shows going over as a negative remainder", () => {
    const [progress] = budgetProgress([line({ amount: 100 })], entriesOf([spend("2026-09-03", 130)]), "2026-09");
    expect(progress.remainingCents).toBe(-3000);
  });

  it("lets a refund bring spending back down", () => {
    const rows = [spend("2026-09-03", 100), spend("2026-09-04", -40, { transaction_type: "refund" })];
    const [progress] = budgetProgress([line({ amount: 100 })], entriesOf(rows), "2026-09");
    expect(progress.spentCents).toBe(6000);
  });

  it("measures each line in its own view", () => {
    const johnPlay = line({ scope: "person", person_id: "n", category_id: "personal", subcategory_id: "play", amount: 300 });
    const rows = [
      spend("2026-09-03", 50, { category_id: "personal", subcategory_id: "play", person_id: "n" }),
      spend("2026-09-04", 70, { category_id: "personal", subcategory_id: "play", person_id: "m" }),
    ];
    const entriesFor = (l: Parameters<typeof viewOfLine>[0]) => viewEntries(rows, viewOfLine(l), options);
    const [progress] = budgetProgress([johnPlay], entriesFor, "2026-09");
    expect(progress.spentCents).toBe(5000);
  });

  it("carries unspent money forward in a saving-up fund", () => {
    const travel = line({ kind: "sinking_fund", category_id: "travel", amount: 300, starts_month: "2026-06-01" });
    const rows = [spend("2026-07-10", 500, { category_id: "travel", subcategory_id: "flights" })];
    const [september] = budgetProgress([travel], entriesOf(rows), "2026-09");
    // June–September: 4 × $300 set aside, $500 spent
    expect(september.fund).toEqual({ savedCents: 120000, spentCents: 50000, availableCents: 70000 });
    expect(september.remainingCents).toBe(70000);
    expect(september.spentCents).toBe(0);
  });

  it("keeps a fund's history when its monthly amount changes", () => {
    const before = line({ kind: "sinking_fund", category_id: "travel", amount: 100, starts_month: "2026-01-01", ends_month: "2026-06-01" });
    const after = line({ kind: "sinking_fund", category_id: "travel", amount: 200, starts_month: "2026-07-01" });
    const [progress] = budgetProgress([before, after], entriesOf([]), "2026-09");
    // Jan–Jun 6 × $100, Jul–Sep 3 × $200
    expect(progress.fund?.savedCents).toBe(120000);
  });

  it("totals the plan, counting what's left only for everyday spending and allowances", () => {
    const rows = [spend("2026-09-03", 300), spend("2026-09-04", 1000, { category_id: "home", subcategory_id: "mortgage" })];
    const progress = budgetProgress(
      [line({ amount: 800 }), line({ category_id: "home", kind: "fixed", amount: 1000 })],
      entriesOf(rows),
      "2026-09",
    );
    expect(budgetTotals(progress)).toEqual({ budgetCents: 180000, spentCents: 130000, flexibleRemainingCents: 50000 });
  });

  it("counts spending that no budget covers", () => {
    const rows = [spend("2026-09-03", 300), spend("2026-09-04", 45, { category_id: "dog", subcategory_id: "vet" })];
    const progress = budgetProgress([line({ amount: 800 })], entriesOf(rows), "2026-09");
    expect(unbudgetedCents(viewEntries(rows, everyone, options), progress)).toBe(4500);
  });
});

describe("suggestions", () => {
  const seed = generateSeedData({ endDate: "2026-10-01", johnId: "n", janeId: "m" });
  const id = (name: string) => seed.categories.find((c) => c.name === name)!.id;

  it("picks a budget kind from the category's usual expense type", () => {
    expect(suggestedKind(id("Housing"), id("Mortgage"), seed.categories)).toBe("fixed");
    expect(suggestedKind(id("Food"), id("Groceries"), seed.categories)).toBe("variable");
    expect(suggestedKind(id("Food"), null, seed.categories)).toBe("variable");
    expect(suggestedKind(id("Travel"), null, seed.categories)).toBe("sinking_fund");
    expect(suggestedKind(id("Subscriptions"), null, seed.categories)).toBe("fixed");
  });

  it("rounds suggested amounts to tidy numbers", () => {
    expect(tidyAmount(4321)).toBe(45);
    expect(tidyAmount(23456)).toBe(240);
    expect(tidyAmount(245000)).toBe(2450);
    expect(tidyAmount(245100)).toBe(2475);
    expect(tidyAmount(0)).toBe(0);
  });

  it("gives the demo household a starter plan with no double counting", () => {
    for (const [index, budget] of seed.budgets.entries()) {
      const others = seed.budgets.filter((_, other) => other !== index);
      expect(conflictsWith(budget, others), budget.category_id).toBe(false);
    }
  });
});
