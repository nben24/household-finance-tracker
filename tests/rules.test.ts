import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import { DEFAULT_RULES } from "@/lib/categories/default-rules";
import { kindOf, reviewChanges } from "@/lib/categories/review";
import {
  alwaysByDefault,
  categorize,
  findRule,
  learnFromChoice,
  normalizePattern,
  type RuleLike,
} from "@/lib/categories/rules";
import { defaultRuleRows, findByPath, missingDefaultCategories } from "@/lib/categories/setup";
import { categoryGroups, frequentSubcategories } from "@/lib/categories/view";
import type { CategoryRow } from "@/lib/db/types";
import type { AccountRow } from "@/lib/db/types";
import { buildTransactions } from "@/lib/import/prepare";
import type { NormalizedTransaction } from "@/lib/import/types";
import { generateSeedData } from "@/lib/seed/generate";

const seed = generateSeedData({
  endDate: "2026-10-01",
  johnId: "00000000-0000-4000-8000-000000000001",
  janeId: "00000000-0000-4000-8000-000000000002",
});
const { categories } = seed;
const sub = (path: string) => findByPath(categories, path)!;

function rule(matchType: RuleLike["match_type"], pattern: string, path: string, auto = true): RuleLike {
  const target = sub(path);
  return {
    match_type: matchType,
    pattern,
    category_id: target.categoryId,
    subcategory_id: target.subcategoryId,
    auto_apply: auto,
  };
}

const purchase = (merchant: string, description = merchant.toUpperCase(), bank: string | null = null) => ({
  normalized_merchant: merchant,
  original_description: description,
  bank_category: bank,
  transaction_type: "expense" as const,
});

describe("finding the rule", () => {
  const rules = [
    rule("merchant", "trader joe's", "Food/Groceries"),
    rule("description", "atm", "Personal/Cash"),
    rule("description", "atm fee", "Other/Bank Fees"),
    rule("bank_category", "restaurant-restaurant", "Food/Restaurants"),
    rule("merchant", "amazon", "Personal/Shopping", false),
  ];

  it("matches merchants exactly, ignoring case and spacing", () => {
    expect(findRule(rules, purchase("Trader  Joe's"))?.pattern).toBe("trader joe's");
    expect(findRule(rules, purchase("Trader Joe's Wine Shop"))).toBeNull();
  });

  it("matches description phrases as whole words, longest first", () => {
    expect(findRule(rules, purchase("Somewhere", "ATM WITHDRAWAL 123 MAIN"))?.pattern).toBe("atm");
    expect(findRule(rules, purchase("Somewhere", "NON-NETWORK ATM FEE"))?.pattern).toBe("atm fee");
    expect(findRule(rules, purchase("Riverside Vet", "RIVERSIDE TREATMENT CENTER"))).toBeNull();
  });

  it("prefers the merchant over the description over the bank's category", () => {
    const both = purchase("Trader Joe's", "TRADER JOE S ATM", "Restaurant-Restaurant");
    expect(findRule(rules, both)?.match_type).toBe("merchant");
    expect(findRule(rules, purchase("Local Diner", "LOCAL DINER ATM", "Restaurant-Restaurant"))?.pattern).toBe("atm");
    expect(findRule(rules, purchase("Local Diner", "LOCAL DINER", "Restaurant-Restaurant"))?.match_type).toBe(
      "bank_category",
    );
  });

  it("sorts automatically or only suggests, depending on the rule", () => {
    expect(categorize(purchase("Trader Joe's"), rules, categories)).toMatchObject({
      subcategory_id: sub("Food/Groceries").subcategoryId,
      expense_type: "variable",
      review_status: "auto_categorized",
      categorization_confidence: "high",
    });
    expect(categorize(purchase("Amazon"), rules, categories)).toMatchObject({
      subcategory_id: sub("Personal/Shopping").subcategoryId,
      review_status: "needs_review",
      categorization_confidence: "medium",
    });
  });

  it("never categorizes transfers, income or paybacks", () => {
    for (const type of ["transfer", "credit_card_payment", "income", "reimbursement"] as const) {
      expect(categorize({ ...purchase("Trader Joe's"), transaction_type: type }, rules, categories)).toBeNull();
    }
  });

  it("ignores a rule pointing at a hidden category", () => {
    const hidden = categories.map((c) =>
      c.id === sub("Food/Groceries").subcategoryId ? { ...c, is_active: false } : c,
    );
    expect(categorize(purchase("Trader Joe's"), rules, hidden)).toBeNull();
  });
});

describe("learning from review", () => {
  const groceries = { category_id: sub("Food/Groceries").categoryId, subcategory_id: sub("Food/Groceries").subcategoryId };
  const dog = { category_id: sub("Dog/Supplies").categoryId, subcategory_id: sub("Dog/Supplies").subcategoryId };
  const autoGroceries = { ...groceries, match_type: "merchant" as const, pattern: "x", auto_apply: true };
  const suggestGroceries = { ...autoGroceries, auto_apply: false };

  it("'Always' creates or upgrades to an automatic rule", () => {
    expect(learnFromChoice(null, dog, true)).toEqual({ ...dog, auto_apply: true });
    expect(learnFromChoice(suggestGroceries, groceries, true)).toEqual({ ...groceries, auto_apply: true });
    expect(learnFromChoice(autoGroceries, groceries, true)).toBeNull();
  });

  it("without 'Always', remembers the choice as a suggestion", () => {
    expect(learnFromChoice(null, dog, false)).toEqual({ ...dog, auto_apply: false });
    expect(learnFromChoice(suggestGroceries, dog, false)).toEqual({ ...dog, auto_apply: false });
    expect(learnFromChoice(suggestGroceries, groceries, false)).toBeNull();
  });

  it("downgrades an automatic rule when the same merchant is categorized differently", () => {
    // e.g. Amazon was always Shopping, but this order was dog food
    expect(learnFromChoice(autoGroceries, dog, false)).toEqual({ ...dog, auto_apply: false });
  });

  it("keeps an automatic rule untouched when the choice agrees", () => {
    expect(learnFromChoice(autoGroceries, groceries, false)).toBeNull();
  });

  it("starts 'Always' unticked for merchants that sell many kinds of things", () => {
    expect(alwaysByDefault("Trader Joe's", null)).toBe(true);
    expect(alwaysByDefault("Amazon", null)).toBe(false);
    expect(alwaysByDefault("Target", null)).toBe(false);
    expect(alwaysByDefault("Local Diner", suggestGroceries)).toBe(false);
  });
});

describe("review decisions", () => {
  const john = "00000000-0000-4000-8000-000000000001";
  const jane = "00000000-0000-4000-8000-000000000002";
  const members = [{ id: john }, { id: jane }];
  const base = { amount: -40, transaction_type: "expense" as const, person_id: john, counterparty_id: null };

  it("requires a category for spending and refunds", () => {
    expect(reviewChanges(base, "spending", null, categories, members)).toEqual({ ok: false, error: "Choose a category." });
    const result = reviewChanges(base, "spending", sub("Food/Coffee").subcategoryId, categories, members);
    expect(result).toMatchObject({
      ok: true,
      changes: {
        transaction_type: "expense",
        category_id: sub("Food/Coffee").categoryId,
        subcategory_id: sub("Food/Coffee").subcategoryId,
        expense_type: "discretionary",
        review_status: "reviewed",
      },
    });
  });

  it("refuses a top-level category or an unknown id as the choice", () => {
    expect(reviewChanges(base, "spending", sub("Food/Coffee").categoryId, categories, members).ok).toBe(false);
    expect(reviewChanges(base, "spending", "00000000-0000-4000-8000-00000000dead", categories, members).ok).toBe(false);
  });

  it("clears the category when something turns out not to be spending", () => {
    const result = reviewChanges(
      { ...base, transaction_type: "expense" },
      "transfer",
      sub("Food/Coffee").subcategoryId,
      categories,
      members,
    );
    expect(result).toMatchObject({ ok: true, changes: { transaction_type: "transfer", category_id: null } });
  });

  it("keeps a card payment labeled as such when confirmed as between our accounts", () => {
    const result = reviewChanges({ ...base, transaction_type: "credit_card_payment" }, "transfer", null, categories, members);
    expect(result).toMatchObject({ ok: true, changes: { transaction_type: "credit_card_payment" } });
  });

  it("remembers who paid into the joint account when a deposit is confirmed as between our accounts", () => {
    const deposit = { amount: 1150, transaction_type: "transfer" as const, person_id: null, counterparty_id: john };
    expect(reviewChanges(deposit, "transfer", null, categories, members)).toMatchObject({
      ok: true,
      changes: { transaction_type: "transfer", counterparty_id: john },
    });
    // not for money out of a personal account
    expect(reviewChanges({ ...base, transaction_type: "transfer", counterparty_id: john }, "transfer", null, categories, members)).toMatchObject({
      changes: { counterparty_id: null },
    });
  });

  it("makes a payback with the other person, optionally with a category", () => {
    const result = reviewChanges({ ...base, amount: 200 }, "payback", sub("Food/Groceries").subcategoryId, categories, members);
    expect(result).toMatchObject({
      ok: true,
      changes: { transaction_type: "reimbursement", counterparty_id: jane, subcategory_id: sub("Food/Groceries").subcategoryId },
    });
    expect(reviewChanges({ ...base, amount: 200 }, "payback", null, categories, members)).toMatchObject({
      ok: true,
      changes: { category_id: null },
    });
  });

  it("refuses a payback on a joint account", () => {
    const result = reviewChanges({ ...base, person_id: null }, "payback", null, categories, members);
    expect(result.ok).toBe(false);
  });

  it("picks the investment direction from the sign", () => {
    expect(reviewChanges(base, "investment", null, categories, members)).toMatchObject({
      changes: { transaction_type: "investment_contribution" },
    });
    expect(reviewChanges({ ...base, amount: 40 }, "investment", null, categories, members)).toMatchObject({
      changes: { transaction_type: "investment_withdrawal" },
    });
  });

  it("maps every type to a review choice", () => {
    expect(kindOf("reimbursement")).toBe("payback");
    expect(kindOf("credit_card_payment")).toBe("transfer");
    expect(kindOf("adjustment")).toBe("spending");
  });
});

describe("built-in categories and rules", () => {
  it("every built-in rule points at a built-in category", () => {
    expect(defaultRuleRows(categories)).toHaveLength(DEFAULT_RULES.length);
  });

  it("built-in patterns are unique and lowercase", () => {
    const keys = DEFAULT_RULES.map((r) => `${r.matchType}:${r.pattern}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEFAULT_RULES.every((r) => r.pattern === normalizePattern(r.pattern))).toBe(true);
  });

  it("skips rules whose category was renamed away", () => {
    const renamed = categories.map((c) => (c.name === "Groceries" ? { ...c, name: "Food Shopping" } : c));
    expect(defaultRuleRows(renamed).length).toBeLessThan(DEFAULT_RULES.length);
  });

  it("finds built-in categories a household is missing", () => {
    expect(missingDefaultCategories(categories)).toEqual([]);
    const withoutCash = categories.filter((c) => c.name !== "Cash");
    expect(missingDefaultCategories(withoutCash)).toEqual([
      { parentName: "Personal", name: "Cash", expenseType: "variable", sortOrder: 4 },
    ]);
  });

  it("includes Cash and Bank Fees", () => {
    const names = DEFAULT_CATEGORIES.flatMap((c) => c.subcategories.map((s) => `${c.name}/${s.name}`));
    expect(names).toContain("Personal/Cash");
    expect(names).toContain("Other/Bank Fees");
  });
});

describe("category pickers", () => {
  it("leave out hidden categories unless one is currently chosen", () => {
    const cash = sub("Personal/Cash").subcategoryId;
    const hidden: CategoryRow[] = categories.map((c) => (c.id === cash ? { ...c, is_active: false } : c));
    const ids = (groups: ReturnType<typeof categoryGroups>) => groups.flatMap((g) => g.children.map((c) => c.id));
    expect(ids(categoryGroups(hidden))).not.toContain(cash);
    expect(ids(categoryGroups(hidden, [cash]))).toContain(cash);
  });

  it("offer the most used categories first", () => {
    expect(frequentSubcategories([{ subcategory_id: "a" }, { subcategory_id: "b" }, { subcategory_id: "b" }, { subcategory_id: null }])).toEqual(["b", "a"]);
  });
});

describe("import with rules", () => {
  const account: AccountRow = {
    ...seed.accounts.find((a) => a.account_type === "credit_card")!,
  };
  const row = (description: string, merchantHint: string | null = null, bankCategory: string | null = null): NormalizedTransaction => ({
    transactionDate: "2026-09-27",
    postingDate: null,
    originalDescription: description,
    amount: -20,
    transactionTypeHint: null,
    sourceId: null,
    merchantHint,
    bankCategory,
  });
  const build = (rows: NormalizedTransaction[]) =>
    buildTransactions([{ fileName: "x.csv", accountId: account.id, transactions: rows }], [account], [], seed.rules, categories);

  it("sorts known merchants, suggests for varied ones, and falls back to the bank's category", () => {
    const [starbucks, amazon, diner, unknown] = build([
      row("STARBUCKS STORE 123"),
      row("AMZN MKTP US*1A2B3C"),
      row("LOCAL DINER 42", null, "Restaurant-Restaurant"),
      row("SOMEPLACE NEW"),
    ]);
    expect(starbucks).toMatchObject({ subcategory_id: sub("Food/Coffee").subcategoryId, review_status: "auto_categorized" });
    expect(amazon).toMatchObject({ subcategory_id: sub("Personal/Shopping").subcategoryId, review_status: "needs_review" });
    expect(diner).toMatchObject({
      subcategory_id: sub("Food/Restaurants").subcategoryId,
      review_status: "auto_categorized",
      bank_category: "Restaurant-Restaurant",
    });
    expect(unknown).toMatchObject({ category_id: null, review_status: "needs_review" });
  });

  it("still asks about a categorized row when the type itself was uncertain", () => {
    const checking = seed.accounts.find((a) => a.account_name === "John's Checking")!;
    const [zelle] = buildTransactions(
      [{ fileName: "x.csv", accountId: checking.id, transactions: [row("Zelle payment to SAM R ATM")] }],
      [checking],
      [],
      seed.rules,
      categories,
    );
    expect(zelle).toMatchObject({ transaction_type: "expense", review_status: "needs_review", categorization_confidence: "low" });
  });
});
