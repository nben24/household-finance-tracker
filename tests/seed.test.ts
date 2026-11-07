import { describe, expect, it } from "vitest";
import { matchesFilter, sortTransactions } from "@/lib/data/demo";
import { monthKey } from "@/lib/dates";
import { isTransferType } from "@/lib/db/types";
import { isPendingSharedFunding } from "@/lib/finance/shared-account";
import { spendingByPerson, spendingCents } from "@/lib/finance/summary";
import { toCents } from "@/lib/money";
import { generateSeedData } from "@/lib/seed/generate";

const options = {
  endDate: "2026-10-01",
  johnId: "00000000-0000-4000-8000-000000000001",
  janeId: "00000000-0000-4000-8000-000000000002",
};
const seed = generateSeedData(options);
const { transactions, categories, accounts } = seed;

function categoryName(id: string | null) {
  return categories.find((category) => category.id === id)?.name;
}

describe("synthetic seed data", () => {
  it("is deterministic", () => {
    expect(generateSeedData(options)).toEqual(seed);
  });

  it("covers the required breadth", () => {
    expect(seed.members).toHaveLength(2);
    expect(accounts.length).toBeGreaterThanOrEqual(5);
    expect(new Set(transactions.map((t) => monthKey(t.transaction_date))).size).toBeGreaterThanOrEqual(6);
    expect(transactions.every((t) => t.transaction_date <= options.endDate)).toBe(true);

    const subcategories = new Set(transactions.map((t) => categoryName(t.subcategory_id)));
    for (const name of ["Groceries", "Restaurants", "Streaming", "Electricity", "Mortgage", "Gas", "Vet", "Flights", "Shopping"]) {
      expect(subcategories, name).toContain(name);
    }
    const types = new Set(transactions.map((t) => t.transaction_type));
    for (const type of ["expense", "income", "transfer", "credit_card_payment", "refund"]) {
      expect(types, type).toContain(type);
    }
  });

  it("only references its own accounts, categories and members", () => {
    const accountIds = new Set(accounts.map((account) => account.id));
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const memberIds = new Set(seed.members.map((member) => member.user_id));
    for (const t of transactions) {
      expect(accountIds.has(t.account_id)).toBe(true);
      if (t.person_id) expect(memberIds.has(t.person_id)).toBe(true);
      if (t.subcategory_id) {
        expect(categoryById.get(t.subcategory_id)?.parent_id).toBe(t.category_id);
      }
      expect(t.is_transfer).toBe(isTransferType(t.transaction_type));
    }
    expect(new Set(transactions.map((t) => t.id)).size).toBe(transactions.length);
  });

  it("contains no account, card or routing numbers", () => {
    for (const account of accounts) expect(account.last_four).toMatch(/^\d{4}$/);
    const columns = Object.keys(accounts[0]).join(" ");
    expect(columns).not.toMatch(/number|routing|credential|password/i);
  });

  it("balances every transfer, card payment and payback to zero", () => {
    // except the one deposit the joint account's statement doesn't show yet
    const pending = transactions.filter(isPendingSharedFunding);
    expect(pending).toHaveLength(1);
    const movedCents = transactions
      .filter((t) => !isPendingSharedFunding(t))
      .filter((t) => t.is_transfer || ["investment_contribution", "reimbursement"].includes(t.transaction_type))
      .reduce((total, t) => total + toCents(t.amount), 0);
    expect(movedCents).toBe(0);
  });

  it("has plausible monthly spending that excludes transfers", () => {
    const august = transactions.filter((t) => monthKey(t.transaction_date) === "2026-08");
    const spending = spendingCents(august);
    expect(spending).toBeGreaterThan(400000);
    expect(spending).toBeLessThan(1200000);
  });

  it("splits personal spending without changing the household total", () => {
    const august = transactions.filter((t) => monthKey(t.transaction_date) === "2026-08");
    const people = [
      { id: options.johnId, name: "John" },
      { id: options.janeId, name: "Jane" },
    ];
    const byPerson = spendingByPerson(august, people);
    expect(byPerson.reduce((total, group) => total + group.cents, 0)).toBe(spendingCents(august));
    expect(august.some((t) => t.transaction_type === "reimbursement")).toBe(true);
  });

  it("includes a legitimate same-day duplicate purchase", () => {
    const twins = transactions.filter(
      (t) => t.original_description === "STARBUCKS STORE 08842" && toCents(t.amount) === -575,
    );
    expect(twins).toHaveLength(2);
    expect(twins[0].transaction_date).toBe(twins[1].transaction_date);
  });

  it("leaves recent uncertain items in the review queue, uncategorized when unknown", () => {
    const queue = transactions.filter((t) => t.review_status === "needs_review");
    expect(queue.length).toBeGreaterThanOrEqual(3);
    expect(queue.some((t) => t.category_id === null && t.categorization_confidence === "low")).toBe(true);
    expect(queue.some((t) => t.category_id !== null && t.categorization_confidence === "medium")).toBe(true);
    expect(queue.every((t) => t.transaction_date >= "2026-09-18")).toBe(true);
  });
});

describe("demo transaction filters", () => {
  const groceries = categories.find((category) => category.name === "Food")!;

  it("filters by date range, category, person and review status", () => {
    const inSeptember = transactions.filter((t) =>
      matchesFilter(t, { from: "2026-09-01", to: "2026-09-30", categoryId: groceries.id }),
    );
    expect(inSeptember.length).toBeGreaterThan(0);
    expect(inSeptember.every((t) => monthKey(t.transaction_date) === "2026-09" && t.category_id === groceries.id)).toBe(true);

    const shared = transactions.filter((t) => matchesFilter(t, { personId: "household" }));
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.every((t) => t.person_id === null)).toBe(true);

    const review = transactions.filter((t) => matchesFilter(t, { needsReview: true }));
    expect(review.every((t) => t.review_status === "needs_review")).toBe(true);
  });

  it("searches merchant and original description, ignoring case", () => {
    const byMerchant = transactions.filter((t) => matchesFilter(t, { search: "trader joe" }));
    const byDescription = transactions.filter((t) => matchesFilter(t, { search: "amzn mktp" }));
    expect(byMerchant.length).toBeGreaterThan(0);
    expect(byDescription.every((t) => t.normalized_merchant === "Amazon")).toBe(true);
    expect(byDescription.length).toBeGreaterThan(0);
  });
});

describe("sorting transactions", () => {
  const { transactions } = generateSeedData(options);
  const sample = transactions.slice(0, 200);

  it("puts the biggest money out or in first, newest first among equal amounts", () => {
    const out = sortTransactions(sample, "largest_out");
    expect(out[0].amount).toBe(Math.min(...sample.map((t) => t.amount)));
    expect(out.every((t, i) => i === 0 || out[i - 1].amount <= t.amount)).toBe(true);
    const into = sortTransactions(sample, "largest_in");
    expect(into[0].amount).toBe(Math.max(...sample.map((t) => t.amount)));
  });

  it("orders by date either way, without changing the list it was given", () => {
    const before = sample.map((t) => t.id);
    const newest = sortTransactions(sample, "newest");
    const oldest = sortTransactions(sample, "oldest");
    expect(newest[0].transaction_date >= newest.at(-1)!.transaction_date).toBe(true);
    expect(oldest[0].transaction_date).toBe(newest.at(-1)!.transaction_date);
    expect(sample.map((t) => t.id)).toEqual(before);
  });
});

describe("the demo household", () => {
  it("uses only made-up people and none of the household's real banks", async () => {
    const { demoDataSource } = await import("@/lib/data/demo");
    const session = await demoDataSource.getSession();
    expect(session?.members.map((m) => m.name)).toEqual(["John", "Jane"]);
    expect(session?.household?.name).toBe("John & Jane Doe");
    const year = generateSeedData({ ...options, months: 12 });
    expect(JSON.stringify(year)).not.toMatch(/truist|american express|bank of america/i);
    expect(year.incomeSources).toHaveLength(2);
    expect(year.transactions.some((t) => t.is_private)).toBe(true);
    expect(year.transactions.some((t) => t.awaiting_post)).toBe(true);
  });
});
