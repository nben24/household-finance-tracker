import { describe, expect, it } from "vitest";
import type { TransactionRow, TransactionType } from "@/lib/db/types";
import {
  countsAsSpending,
  otherSpending,
  spendingByCategory,
  spendingByMonth,
  spendingByPerson,
  spendingCents,
  summarize,
} from "@/lib/finance/summary";

type Row = Pick<
  TransactionRow,
  "amount" | "transaction_type" | "category_id" | "person_id" | "counterparty_id" | "review_status" | "transaction_date"
>;

function row(amount: number, type: TransactionType, overrides: Partial<Row> = {}): Row {
  return {
    amount,
    transaction_type: type,
    category_id: null,
    person_id: null,
    counterparty_id: null,
    review_status: "reviewed",
    transaction_date: "2026-09-15",
    ...overrides,
  };
}

describe("what counts as spending", () => {
  it("counts only expenses and refunds", () => {
    const counted = (type: TransactionType) => countsAsSpending({ transaction_type: type });
    expect(counted("expense")).toBe(true);
    expect(counted("refund")).toBe(true);
    for (const type of [
      "income",
      "transfer",
      "credit_card_payment",
      "adjustment",
      "investment_contribution",
      "investment_withdrawal",
    ] as TransactionType[]) {
      expect(counted(type)).toBe(false);
    }
  });

  it("does not double count a credit card payment", () => {
    const transactions = [
      row(-1500, "expense"), // purchases made on the card
      row(-1500, "credit_card_payment"), // checking → card
      row(1500, "credit_card_payment"), // card receives payment
    ];
    expect(spendingCents(transactions)).toBe(150000);
  });

  it("ignores transfers to savings and investment contributions", () => {
    const transactions = [
      row(-500, "transfer"),
      row(500, "transfer"),
      row(-400, "investment_contribution"),
      row(-82.41, "expense"),
    ];
    expect(spendingCents(transactions)).toBe(8241);
  });

  it("lets a refund reduce spending", () => {
    expect(spendingCents([row(-100, "expense"), row(30.5, "refund")])).toBe(6950);
  });

  it("does not treat a positive non-income amount as income", () => {
    const summary = summarize([row(1500, "credit_card_payment"), row(25, "refund"), row(3150, "income")]);
    expect(summary.incomeCents).toBe(315000);
  });

  it("adds many small amounts exactly", () => {
    const transactions = Array.from({ length: 1000 }, () => row(-0.1, "expense"));
    expect(spendingCents(transactions)).toBe(10000);
  });
});

describe("summarize", () => {
  it("reports income, spending, what is left, and the review count", () => {
    const summary = summarize([
      row(3000, "income"),
      row(-1200.5, "expense"),
      row(-99.5, "expense", { review_status: "needs_review" }),
      row(-800, "transfer"),
    ]);
    expect(summary).toEqual({
      incomeCents: 300000,
      spendingCents: 130000,
      netCents: 170000,
      transactionCount: 4,
      needsReviewCount: 1,
    });
  });

  it("handles an empty period", () => {
    expect(summarize([])).toEqual({
      incomeCents: 0,
      spendingCents: 0,
      netCents: 0,
      transactionCount: 0,
      needsReviewCount: 0,
    });
  });
});

describe("grouping", () => {
  const categories = [
    { id: "food", name: "Food" },
    { id: "dog", name: "Dog" },
  ];

  it("groups spending by category, largest first, with uncategorized separate", () => {
    const groups = spendingByCategory(
      [
        row(-50, "expense", { category_id: "food" }),
        row(-25, "expense", { category_id: "food" }),
        row(-90, "expense", { category_id: "dog" }),
        row(-10, "expense"),
        row(-999, "transfer", { category_id: "food" }),
      ],
      categories,
    );
    expect(groups).toEqual([
      { id: "dog", name: "Dog", cents: 9000, count: 1 },
      { id: "food", name: "Food", cents: 7500, count: 2 },
      { id: null, name: "Not yet categorized", cents: 1000, count: 1 },
    ]);
  });

  it("groups spending by person, with shared spending as Household", () => {
    const groups = spendingByPerson(
      [
        row(-40, "expense", { person_id: "n" }),
        row(-60, "expense", { person_id: "m" }),
        row(-2450, "expense"),
      ],
      [
        { id: "n", name: "John" },
        { id: "m", name: "Jane" },
      ],
    );
    expect(groups.map((group) => [group.name, group.cents])).toEqual([
      ["Shared", 245000],
      ["Jane", 6000],
      ["John", 4000],
    ]);
  });

  it("splits a shared purchase when one person pays the other back", () => {
    // John buys $400 of groceries; Jane sends him $200. The payback shows
    // in both accounts but must only count once.
    const people = [
      { id: "n", name: "John" },
      { id: "m", name: "Jane" },
    ];
    const transactions = [
      row(-400, "expense", { person_id: "n", category_id: "food" }),
      row(-200, "reimbursement", { person_id: "m", counterparty_id: "n" }), // out of Jane's account
      row(200, "reimbursement", { person_id: "n", counterparty_id: "m" }), // into John's account
    ];
    expect(spendingCents(transactions)).toBe(40000);
    expect(summarize(transactions).incomeCents).toBe(0);
    expect(spendingByCategory(transactions, categories)).toEqual([{ id: "food", name: "Food", cents: 40000, count: 1 }]);
    expect(spendingByPerson(transactions, people).map((group) => [group.name, group.cents])).toEqual([
      ["Jane", 20000],
      ["John", 20000],
    ]);
  });

  it("counts a payback even when only the receiving side was imported", () => {
    const people = [
      { id: "n", name: "John" },
      { id: "m", name: "Jane" },
    ];
    const groups = spendingByPerson(
      [row(-90, "expense", { person_id: "n" }), row(30, "reimbursement", { person_id: "n", counterparty_id: "m" })],
      people,
    );
    expect(groups.map((group) => [group.name, group.cents])).toEqual([
      ["John", 6000],
      ["Jane", 3000],
    ]);
  });

  it("keeps transactions in their own month when they sit on a boundary", () => {
    const totals = spendingByMonth(
      [
        row(-10, "expense", { transaction_date: "2026-08-31" }),
        row(-20, "expense", { transaction_date: "2026-09-01" }),
        row(-30, "expense", { transaction_date: "2026-09-30" }),
      ],
      ["2026-08", "2026-09", "2026-10"],
    );
    expect(totals).toEqual([
      { month: "2026-08", cents: 1000 },
      { month: "2026-09", cents: 5000 },
      { month: "2026-10", cents: 0 },
    ]);
  });
});

describe("Other", () => {
  it("adds up spending filed under the top-level Other category", () => {
    const categories = [
      { id: "other", name: "Other", parent_id: null },
      { id: "food", name: "Food", parent_id: null },
    ];
    const result = otherSpending(
      [
        row(-40, "expense", { category_id: "other" }),
        row(-60, "expense", { category_id: "other" }),
        row(-500, "expense", { category_id: "food" }),
        row(-999, "transfer", { category_id: "other" }),
      ],
      categories,
    );
    expect(result).toEqual({ categoryId: "other", cents: 10000, count: 2 });
  });
});
