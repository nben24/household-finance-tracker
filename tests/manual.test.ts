import { describe, expect, it } from "vitest";
import { isCashAccount } from "@/lib/import/manual";
import {
  decideMatches,
  matchDistance,
  matchManualEntries,
  merchantSimilarity,
  mergeWithEntry,
  proposeMatches,
} from "@/lib/import/manual-match";

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

describe("a private entry when its bank version posts", () => {
  const bankRow = {
    transaction_date: "2026-10-04",
    amount: -150,
    original_description: "TIFFANY & CO 123",
    normalized_merchant: "Tiffany & Co",
    source_hash: "abc",
    category_id: "shopping",
    subcategory_id: "jewelry",
    review_status: "auto_categorized" as const,
    notes: null,
    // what every imported row carries
    is_private: false,
    private_until: null,
  };
  const privateEntry = {
    category_id: "gifts",
    subcategory_id: "gifts-sub",
    expense_type: "irregular" as const,
    transaction_type: "expense" as const,
    review_status: "reviewed" as const,
    notes: "Anniversary present",
    categorization_reason: "Chosen by you",
    is_private: true,
    private_until: "2026-12-25",
  };

  it("stays private, keeps its reveal date and every decision the person made", () => {
    const merged = mergeWithEntry(privateEntry, bankRow);
    expect(merged).toMatchObject({
      is_private: true,
      private_until: "2026-12-25",
      category_id: "gifts",
      subcategory_id: "gifts-sub",
      notes: "Anniversary present",
      review_status: "reviewed",
      // and the bank's own details
      amount: -150,
      source_hash: "abc",
      is_manual: false,
      awaiting_post: false,
    });
  });

  it("stays private with no reveal date when none was set", () => {
    expect(mergeWithEntry({ ...privateEntry, private_until: null }, bankRow)).toMatchObject({ is_private: true, private_until: null });
  });

  it("leaves a public entry public", () => {
    expect(mergeWithEntry({ ...privateEntry, is_private: false, private_until: null }, bankRow)).toMatchObject({
      is_private: false,
      private_until: null,
    });
  });
});

describe("checking a match with the merchant name", () => {
  const typed = (id: string, merchant: string, date: string, amount: number) => ({
    id,
    account_id: "card",
    transaction_date: date,
    amount,
    awaiting_post: true,
    normalized_merchant: merchant,
  });
  const posted = (merchant: string, date: string, amount: number, hash: string) => ({
    account_id: "card",
    transaction_date: date,
    amount,
    normalized_merchant: merchant,
    source_hash: hash,
  });

  it("scores names by shared words, ignoring numbers and filler", () => {
    expect(merchantSimilarity("Diner", "Local Diner")).toBe(1);
    expect(merchantSimilarity("Starbuck", "Starbucks #1234")).toBe(1);
    expect(merchantSimilarity("Trader Joe's", "Shell Oil 5532")).toBe(0);
    expect(merchantSimilarity("", "Anything")).toBe(0);
  });

  it("replaces automatically only when the names agree and nothing else fits (a tip is fine)", () => {
    const [proposal] = proposeMatches([typed("dinner", "Diner", "2026-10-03", -50)], [posted("Local Diner", "2026-10-04", -60, "h1")]);
    expect(proposal).toMatchObject({ entryId: "dinner", strength: "strong", alternatives: 0 });
  });

  it("asks about an unrelated purchase with a similar amount", () => {
    const [proposal] = proposeMatches([typed("dinner", "Diner", "2026-10-03", -50)], [posted("Shell Oil", "2026-10-04", -50, "h1")]);
    expect(proposal.strength).toBe("possible");
    // Without a "Same purchase" answer, it's kept separate.
    expect(decideMatches([typed("dinner", "Diner", "2026-10-03", -50)], [posted("Shell Oil", "2026-10-04", -50, "h1")], []).size).toBe(0);
  });

  it("asks when there's more than one candidate, even with matching names", () => {
    const entries = [typed("a", "Starbucks", "2026-10-03", -6), typed("b", "Starbucks", "2026-10-04", -6)];
    const proposals = proposeMatches(entries, [posted("Starbucks", "2026-10-04", -6, "h1")]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].strength).toBe("possible");
  });

  it("follows the person's answers, re-checking each one", () => {
    const entries = [typed("dinner", "Diner", "2026-10-03", -50)];
    const incoming = [posted("Shell Oil", "2026-10-04", -50, "h1"), posted("Local Diner", "2026-10-04", -55, "h2")];
    // "Same purchase" for the gas station row wins over the automatic guess.
    expect(decideMatches(entries, incoming, [{ entryId: "dinner", sourceHash: "h1", same: true }])).toEqual(new Map([[0, "dinner"]]));
    // "Keep separate" on the strong guess leaves both rows as new transactions.
    expect(decideMatches(entries, incoming, [{ entryId: "dinner", sourceHash: "h2", same: false }]).size).toBe(0);
    // An accepted pair that no longer fits (entry already posted) is ignored.
    const posted_ = [{ ...entries[0], awaiting_post: false }];
    expect(decideMatches(posted_, incoming, [{ entryId: "dinner", sourceHash: "h1", same: true }]).size).toBe(0);
    // An accepted pair that's too far apart in amount is ignored too.
    expect(
      decideMatches(entries, [posted("Shell Oil", "2026-10-04", -500, "h3")], [{ entryId: "dinner", sourceHash: "h3", same: true }]).size,
    ).toBe(0);
  });

  it("never matches the same entry twice across repeated imports", () => {
    const entries = [typed("dinner", "Diner", "2026-10-03", -50)];
    const incoming = [posted("Local Diner", "2026-10-04", -55, "h1"), posted("Local Diner", "2026-10-04", -55, "h2")];
    const decided = decideMatches(entries, incoming, [
      { entryId: "dinner", sourceHash: "h1", same: true },
      { entryId: "dinner", sourceHash: "h2", same: true },
    ]);
    expect([...decided.values()]).toEqual(["dinner"]);
  });
});
