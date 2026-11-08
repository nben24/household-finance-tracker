import { describe, expect, it } from "vitest";
import type { TransactionType } from "@/lib/db/types";
import {
  flowSentence,
  monthlyFlow,
  namedCategories,
  OTHER,
  paceSentence,
  purchases,
  spendingPace,
  spendingSlices,
  slicesSentence,
} from "@/lib/finance/charts";
import { viewEntries, viewTotals, type View } from "@/lib/finance/views";
import { generateSeedData } from "@/lib/seed/generate";

const J = "j";
const everyone: View = { kind: "everyone" };
const options = { memberCount: 2, mode: "separate" as const };
const categories = ["food", "home", "car", "fun", "dog", "gifts", "travel"].map((id) => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
}));

let next = 0;
function row(
  date: string,
  amount: number,
  category: string | null,
  type: TransactionType = "expense",
  person: string | null = J,
) {
  next += 1;
  return {
    id: `t${next}`,
    transaction_date: date,
    amount,
    transaction_type: type,
    person_id: person,
    counterparty_id: null,
    category_id: category,
    subcategory_id: null,
    normalized_merchant: `Shop ${next}`,
    expense_type: category === "home" ? ("fixed" as const) : null,
    is_private: false,
    private_until: null,
  };
}

describe("where the money went", () => {
  const rows = [
    row("2026-09-03", -600, "home"),
    row("2026-09-04", -300, "food"),
    row("2026-09-05", -100, "car"),
    row("2026-09-06", -60, "fun"),
    row("2026-09-07", -40, "dog"),
    row("2026-09-08", -30, "gifts"),
    row("2026-09-09", -20, "travel"),
    row("2026-10-02", -200, "food"),
    row("2026-10-03", -50, "travel"),
  ];
  const entries = viewEntries(rows, everyone, options);
  const named = namedCategories(entries, categories);

  it("gives the five biggest categories over the range a fixed color, and folds the rest into Other", () => {
    expect(named).toEqual(["home", "food", "car", "travel", "fun"]);
    const october = spendingSlices(entries, categories, "2026-10", named);
    expect(october.map((s) => [s.id, s.cents, s.slot])).toEqual([
      ["food", 20000, 2],
      ["travel", 5000, 4],
    ]);
    const september = spendingSlices(entries, categories, "2026-09", named);
    expect(september.at(-1)).toMatchObject({ id: OTHER, cents: 7000, slot: 0 });
    expect(september.reduce((total, s) => total + s.share, 0)).toBeCloseTo(1);
  });

  it("says which category led, in plain words", () => {
    expect(slicesSentence(spendingSlices(entries, categories, "2026-10", named), "2026-10")).toBe(
      "Food was the biggest share of October 2026's $250: $200, or 80%, followed by Travel at 20%.",
    );
    expect(slicesSentence([], "2026-11")).toMatch(/No spending/);
  });
});

describe("money in vs. money out", () => {
  it("matches the dashboard's totals for every month", () => {
    const seed = generateSeedData({ endDate: "2026-10-31", johnId: "a", janeId: "b", months: 6 });
    const view: View = { kind: "person", personId: "a" };
    const entries = viewEntries(seed.transactions, view, options);
    const months = ["2026-08", "2026-09", "2026-10"];
    const flow = monthlyFlow(entries, view, months);
    flow.forEach((month, index) => {
      const totals = viewTotals(
        entries.filter((e) => e.date.startsWith(months[index])),
        view,
      );
      expect(month.leftOverCents).toBe(totals.netCents);
      expect(month.setAsideCents).toBe(totals.savedCents + totals.investedCents);
    });
    expect(flowSentence(flow)).toMatch(/of 3 months ended with money left over/);
  });
});

describe("are we on pace?", () => {
  const rows = [
    row("2026-08-05", -100, "food"),
    row("2026-08-20", -100, "food"),
    row("2026-09-05", -300, "food"),
    row("2026-09-20", -100, "food"),
    row("2026-10-03", -50, "food"),
    row("2026-10-08", -400, "food"),
  ];
  const entries = viewEntries(rows, everyone, options);

  it("runs this month day by day against the middle of earlier months", () => {
    const pace = spendingPace(entries, "2026-10", "2026-10-10", "2026-08-01");
    expect(pace.soFar).toHaveLength(10);
    expect(pace.soFar[9]).toBe(45000);
    expect(pace.historyMonths).toBe(2);
    // by the 10th: August $100, September $300 → typical $200
    expect(pace.typical?.[9]).toBe(20000);
    expect(paceSentence(pace)).toBe("$450 spent through Oct 10: $250 more than a typical month by this point.");
  });

  it("skips months the data doesn't fully cover", () => {
    expect(spendingPace(entries, "2026-10", "2026-10-10", "2026-09-15").typical).toBeNull();
  });
});

describe("purchases", () => {
  it("lists the view's purchases largest first and keeps someone else's private gift private", () => {
    const gift = {
      ...row("2026-10-04", -90, "gifts", "expense", "partner"),
      is_private: true,
      private_until: "2026-12-01",
    };
    const rows = [
      row("2026-10-02", -20, "food"),
      row("2026-10-03", -300, "home"),
      gift,
      row("2026-10-05", 15, "food", "refund"),
    ];
    const list = purchases(rows, everyone, "2026-10", "2026-10-10", J);
    // the $300 "home" row is a fixed bill, so it's left out
    expect(list.map((p) => p.cents)).toEqual([9000, 2000]);
    expect(list[0]).toMatchObject({ merchant: "Private purchase", categoryId: null });
    expect(purchases(rows, everyone, "2026-10", "2026-10-10", "partner")[0].merchant).not.toBe("Private purchase");
    expect(purchases(rows, { kind: "person", personId: J }, "2026-10", "2026-10-10", J)).toHaveLength(1);
  });
});
