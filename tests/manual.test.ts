import { describe, expect, it } from "vitest";
import { isCashAccount } from "@/lib/import/manual";
import { matchDistance, matchManualEntries, mergeWithEntry } from "@/lib/import/manual-match";

const entry = (id: string, date: string, amount: number, overrides: Record<string, unknown> = {}) => ({
  id,
  account_id: "card",
  transaction_date: date,
  amount,
  awaiting_post: true,
  ...overrides,
});
const bank = (date: string, amount: number, account = "card") => ({ account_id: account, transaction_date: date, amount });

describe("matching a hand-added entry to the bank's version", () => {
  it("matches the same purchase posting a couple of days later with a tip added", () => {
    // $50 typed in on Saturday; the bank shows $60 dated Saturday or Monday
    expect(matchDistance(entry("e", "2026-10-03", -50), bank("2026-10-03", -60))).not.toBeNull();
    expect(matchDistance(entry("e", "2026-10-03", -50), bank("2026-10-05", -50))).not.toBeNull();
  });

  it("refuses a different account, the wrong direction, too big a difference, or too far apart", () => {
    const typed = entry("e", "2026-10-03", -50);
    expect(matchDistance(typed, bank("2026-10-03", -50, "other card"))).toBeNull();
    expect(matchDistance(typed, bank("2026-10-03", 50))).toBeNull();
    expect(matchDistance(typed, bank("2026-10-03", -63))).toBeNull(); // 26% more
    expect(matchDistance(typed, bank("2026-10-03", -37.5))).not.toBeNull(); // exactly 25% less
    expect(matchDistance(typed, bank("2026-09-29", -50))).toBeNull(); // 4 days before
    expect(matchDistance(typed, bank("2026-10-11", -50))).toBeNull(); // 8 days after
  });

  it("ignores entries that aren't waiting (cash, or kept for good)", () => {
    expect(matchDistance(entry("e", "2026-10-03", -50, { awaiting_post: false }), bank("2026-10-03", -50))).toBeNull();
  });

  it("pairs the closest ones first and never uses an entry or a bank row twice", () => {
    const entries = [entry("lunch", "2026-10-03", -20), entry("dinner", "2026-10-03", -50)];
    const incoming = [bank("2026-10-04", -55), bank("2026-10-04", -21), bank("2026-10-04", -20)];
    const matches = matchManualEntries(entries, incoming);
    expect(Object.fromEntries(matches)).toEqual({ 0: "dinner", 2: "lunch" });
  });

  it("matches nothing when nothing fits", () => {
    expect(matchManualEntries([entry("e", "2026-10-03", -50)], [bank("2026-10-03", -500)]).size).toBe(0);
  });
});

describe("what the entry becomes", () => {
  const bankRow = {
    transaction_date: "2026-10-04",
    amount: -60,
    original_description: "TST* LOCAL DINER 123",
    normalized_merchant: "Local Diner",
    source_hash: "abc",
    category_id: null,
    subcategory_id: null,
    review_status: "needs_review" as const,
    notes: null,
  };

  it("takes the bank's details but keeps the person's category and note", () => {
    const merged = mergeWithEntry(
      {
        category_id: "food",
        subcategory_id: "restaurants",
        expense_type: "discretionary",
        transaction_type: "expense",
        review_status: "reviewed",
        notes: "Anniversary dinner",
        categorization_reason: "Chosen by you",
      },
      bankRow,
    );
    expect(merged).toMatchObject({
      transaction_date: "2026-10-04",
      amount: -60,
      source_hash: "abc",
      category_id: "food",
      subcategory_id: "restaurants",
      review_status: "reviewed",
      notes: "Anniversary dinner",
      is_manual: false,
      awaiting_post: false,
    });
  });

  it("uses the bank's sorting when the person didn't choose a category", () => {
    const merged = mergeWithEntry(
      {
        category_id: null,
        subcategory_id: null,
        expense_type: null,
        transaction_type: "expense",
        review_status: "needs_review",
        notes: null,
        categorization_reason: "Added by hand",
      },
      { ...bankRow, category_id: "food", review_status: "auto_categorized" as const },
    );
    expect(merged).toMatchObject({ category_id: "food", review_status: "auto_categorized", is_manual: false });
  });
});

describe("cash", () => {
  it("is recognized by its institution name", () => {
    expect(isCashAccount({ institution: "Cash" })).toBe(true);
    expect(isCashAccount({ institution: " cash " })).toBe(true);
    expect(isCashAccount({ institution: "Chase" })).toBe(false);
  });
});
