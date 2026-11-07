import { describe, expect, it } from "vitest";
import { categorizeMerchants, type AskModel } from "@/lib/ai/categorize-merchants";
import { categoryOptions, merchantsToAsk, sortUnknownMerchantsWithAi } from "@/lib/categories/ai-sort";
import { ruleChanges } from "@/lib/categories/apply";
import { groupByMerchant, sortSource, sortSources, spotCheckSample } from "@/lib/categories/catch-up";
import { categorize, type RuleLike } from "@/lib/categories/rules";
import { findByPath } from "@/lib/categories/setup";
import type { DataSource, RuleInput } from "@/lib/data/types";
import type { TransactionRow } from "@/lib/db/types";
import { normalizeMerchant } from "@/lib/import/merchant";
import { generateSeedData } from "@/lib/seed/generate";

const seed = generateSeedData({ endDate: "2026-10-01", johnId: "n", janeId: "m" });
const { categories } = seed;
const sub = (path: string) => findByPath(categories, path)!;
const base = seed.transactions.find((t) => t.transaction_type === "expense")!;

function tx(overrides: Partial<TransactionRow>): TransactionRow {
  return {
    ...base,
    id: overrides.id ?? `t-${Math.random()}`,
    category_id: null,
    subcategory_id: null,
    expense_type: null,
    review_status: "needs_review",
    categorization_confidence: "high",
    categorization_reason: "Card purchase",
    bank_category: null,
    ...overrides,
  };
}

const suggestion = (path: string, auto: boolean): RuleLike => ({
  match_type: "merchant",
  pattern: "corner bakery",
  category_id: sub(path).categoryId,
  subcategory_id: sub(path).subcategoryId,
  auto_apply: auto,
});

describe("history is sorted without asking", () => {
  const bakery = (date: string, overrides: Partial<TransactionRow> = {}) =>
    tx({ transaction_date: date, normalized_merchant: "Corner Bakery", ...overrides });
  const decide = (row: TransactionRow, rule: RuleLike) => ruleChanges(row, categorize(row, [rule], categories), "2026-09-27");

  it("accepts a suggestion for history, but still asks about recent ones", () => {
    const rule = suggestion("Food/Restaurants", false);
    expect(decide(bakery("2026-09-01"), rule)).toMatchObject({
      review_status: "auto_categorized",
      subcategory_id: sub("Food/Restaurants").subcategoryId,
    });
    const recent = decide(bakery("2026-09-28"), rule);
    expect(recent).toMatchObject({ review_status: "needs_review", subcategory_id: sub("Food/Restaurants").subcategoryId });
  });

  it("accepts history that isn't spending, like transfers and paybacks", () => {
    const transfer = bakery("2026-09-01", { transaction_type: "transfer", categorization_confidence: "medium" });
    expect(ruleChanges(transfer, null, "2026-09-27")).toMatchObject({ review_status: "auto_categorized" });
  });

  it("still asks when the kind of transaction is unclear, even in history", () => {
    const zelle = bakery("2026-09-01", { categorization_confidence: "low" });
    expect(decide(zelle, suggestion("Food/Restaurants", true))).toMatchObject({ review_status: "needs_review" });
    expect(ruleChanges(zelle, null, "2026-09-27")).toBeNull();
  });

  it("leaves uncategorized history purchases for Catch-up", () => {
    expect(ruleChanges(bakery("2026-09-01"), null, "2026-09-27")).toBeNull();
  });

  it("changes nothing when there is no history date", () => {
    expect(decide(bakery("2026-09-01"), suggestion("Food/Restaurants", false))).not.toBeNull();
    expect(ruleChanges(bakery("2026-09-01"), categorize(bakery("2026-09-01"), [suggestion("Food/Restaurants", false)], categories), null)).toMatchObject({
      review_status: "needs_review",
    });
  });
});

describe("what is sent to the AI", () => {
  const rows = [
    tx({ normalized_merchant: "Corner Bakery", bank_category: "Restaurant-Restaurant" }),
    tx({ normalized_merchant: "corner  bakery" }),
    tx({ normalized_merchant: "Zelle · Riley Test" }),
    tx({ normalized_merchant: "Venmo · Sam R" }),
    tx({ normalized_merchant: "Trader Joe's" }),
    tx({ normalized_merchant: "Categorized Already", category_id: sub("Food/Coffee").categoryId }),
    tx({ normalized_merchant: "Paycheck Co", transaction_type: "income" }),
  ];

  it("asks once per unknown merchant, and never about people or known merchants", () => {
    expect(merchantsToAsk(rows, new Set(["trader joe's"]))).toEqual([
      { merchant: "Corner Bakery", bankCategory: "Restaurant-Restaurant" },
    ]);
  });

  it("never includes amounts, dates or descriptions", () => {
    const sent = JSON.stringify(merchantsToAsk(rows, new Set()));
    expect(sent).not.toContain(String(Math.abs(base.amount)));
    expect(sent).not.toContain(base.transaction_date);
    expect(sent).not.toContain(base.original_description);
  });

  it("offers every active subcategory as a choice", () => {
    const options = categoryOptions(categories);
    expect(options).toContainEqual({ label: "Food › Restaurants", subcategoryId: sub("Food/Restaurants").subcategoryId });
    expect(options.length).toBe(categories.filter((c) => c.parent_id !== null).length);
  });
});

describe("reading the AI's answers", () => {
  const options = categoryOptions(categories);
  const fakeAsk =
    (results: unknown[]): AskModel =>
    async (_system, user, schema) => {
      // the request is constrained to the category list
      const enumValues = (((schema.properties as Record<string, { items: { properties: { category: { enum: string[] } } } }>).results.items.properties.category.enum));
      expect(enumValues).toContain("Food › Restaurants");
      expect(user).toContain("Corner Bakery");
      return JSON.stringify({ results });
    };

  it("maps answers back to merchants and categories", async () => {
    const answers = await categorizeMerchants(
      [
        { merchant: "Corner Bakery", bankCategory: null },
        { merchant: "Mystery LLC", bankCategory: null },
        { merchant: "Fuzzy Paws Grooming", bankCategory: null },
      ],
      options,
      fakeAsk([
        { index: 0, category: "Food › Restaurants", confidence: "high" },
        { index: 1, category: "Unknown", confidence: "high" },
        { index: 2, category: "Dog › Grooming", confidence: "low" },
        { index: 7, category: "Food › Coffee", confidence: "high" },
        { index: 0, category: "Food › Coffee", confidence: "high" },
      ]),
    );
    expect(answers).toEqual([
      { merchant: "Corner Bakery", subcategoryId: sub("Food/Restaurants").subcategoryId, confidence: "high" },
      { merchant: "Mystery LLC", subcategoryId: null, confidence: "low" },
      { merchant: "Fuzzy Paws Grooming", subcategoryId: sub("Dog/Grooming").subcategoryId, confidence: "low" },
    ]);
  });

  it("saves answers as rules: confident ones sort, unsure ones suggest, unknown ones suggest Other", async () => {
    const saved: RuleInput[] = [];
    const waiting = [
      tx({ normalized_merchant: "Corner Bakery" }),
      tx({ normalized_merchant: "Mystery LLC" }),
      tx({ normalized_merchant: "Fuzzy Paws Grooming" }),
    ];
    const data = {
      listTransactions: async () => ({ rows: waiting, total: waiting.length }),
      listRules: async () => [],
      listCategories: async () => categories,
      addMissingRules: async (_id: string, rules: RuleInput[]) => {
        saved.push(...rules);
      },
    } as unknown as DataSource;

    const result = await sortUnknownMerchantsWithAi(
      data,
      "h",
      fakeAsk([
        { index: 0, category: "Food › Restaurants", confidence: "high" },
        { index: 1, category: "Unknown", confidence: "low" },
        { index: 2, category: "Dog › Grooming", confidence: "low" },
      ]),
    );
    expect(result).toEqual({ asked: 3, confident: 1 });
    expect(saved.map((rule) => [rule.pattern, rule.subcategory_id, rule.auto_apply, rule.source])).toEqual([
      ["corner bakery", sub("Food/Restaurants").subcategoryId, true, "ai"],
      ["mystery llc", sub("Other/Miscellaneous").subcategoryId, false, "ai"],
      ["fuzzy paws grooming", sub("Dog/Grooming").subcategoryId, false, "ai"],
    ]);
  });

  it("explains AI-made categories", () => {
    const rule: RuleLike = { ...suggestion("Food/Restaurants", true), source: "ai" };
    const row = tx({ normalized_merchant: "Corner Bakery" });
    expect(categorize(row, [rule], categories)?.categorization_reason).toBe("AI suggestion");
    expect(sortSource("AI suggestion")).toBe("ai");
  });
});

describe("the Catch-up page", () => {
  it("groups waiting history by merchant, biggest first", () => {
    const groups = groupByMerchant([
      tx({ normalized_merchant: "A", amount: -10, transaction_date: "2026-08-01" }),
      tx({ normalized_merchant: "B", amount: -5, transaction_date: "2026-08-02" }),
      tx({ normalized_merchant: "B", amount: -7, transaction_date: "2026-08-20", subcategory_id: "s1" }),
    ]);
    expect(groups.map((g) => [g.merchant, g.count, g.totalCents, g.from, g.to, g.subcategoryId])).toEqual([
      ["B", 2, 1200, "2026-08-02", "2026-08-20", "s1"],
      ["A", 1, 1000, "2026-08-01", "2026-08-01", null],
    ]);
  });

  it("counts how purchases were sorted", () => {
    const sorted = (reason: string) => tx({ category_id: "c", categorization_reason: reason });
    expect(
      sortSources([
        sorted("Merchant rule"),
        sorted("Suggested by merchant — purchases here vary · accepted automatically for history"),
        sorted("Bank's category rule"),
        sorted("AI suggestion (unsure) · accepted automatically for history"),
        sorted("Chosen in Catch-up"),
        sorted("Chosen during review"),
        tx({ categorization_reason: "Merchant rule" }), // no category: not counted
      ]),
    ).toEqual({ rules: 2, bank: 1, ai: 1, you: 2 });
  });

  it("takes a stable sample for spot-checking", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: String(i).padStart(3, "0") }));
    const sample = spotCheckSample(rows, 10);
    expect(sample).toHaveLength(10);
    expect(spotCheckSample(rows, 10)).toEqual(sample);
  });
});

describe("merchant names", () => {
  it("cleans up the Burger King example and other chains", () => {
    expect(normalizeMerchant("BURGER KING #4123 ALEXANDRIA VA")).toBe("Burger King");
    expect(normalizeMerchant("TST* LOCAL DINER #ALEXANDRIA VA")).toBe("Local Diner");
    expect(normalizeMerchant("WENDYS #1234")).toBe("Wendy's");
    expect(normalizeMerchant("LAND ROVER SERVICE")).not.toBe("Rover");
  });
});
