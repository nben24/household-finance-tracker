// Undo for review decisions: one decision (the transaction, a learned rule,
// and everything else it sorted) is put back in one step, but never over
// someone's newer change.

import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionRow } from "@/lib/db/types";
import { generateSeedData, type SeedData } from "@/lib/seed/generate";
import { asUser, createTestDatabase, createUser, insertSeed } from "./helpers/database";
import { memoryData, type MemoryData } from "./helpers/memory-data";

const TODAY = "2026-10-20";
let data: MemoryData;
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {}, redirect: () => {} }));
vi.mock("@/lib/data/supabase", () => ({ MISSING_MIGRATION: "The database needs an update." }));
vi.mock("@/lib/data", async () => ({
  ...(await import("@/lib/data/filters")),
  getDataSource: () => data,
  requireHousehold: async () => data.getSession(),
}));

const { reviewTransaction, undoReview } = await import("@/app/(app)/review/actions");

describe("undoing a review decision", () => {
  let seed: SeedData;
  let john: string;
  let jane: string;
  const groceries = () => {
    const food = seed.categories.find((c) => c.parent_id === null && c.name === "Food")!;
    return seed.categories.find((c) => c.parent_id === food.id && c.name === "Groceries")!;
  };
  const waitingFrom = (merchant: string, count: number) =>
    Array.from({ length: count }, (_, index) => {
      const row = {
        ...seed.transactions[0],
        id: randomUUID(),
        account_id: seed.accounts.find((a) => a.owner_user_id === john && a.account_type === "credit_card")!.id,
        person_id: john,
        transaction_date: `2026-10-1${index}`,
        normalized_merchant: merchant,
        original_description: merchant.toUpperCase(),
        amount: -20 - index,
        transaction_type: "expense" as const,
        category_id: null,
        subcategory_id: null,
        expense_type: null,
        review_status: "needs_review" as const,
        categorization_confidence: "high" as const,
        categorization_reason: "New merchant",
        bank_category: null,
        is_private: false,
        private_until: null,
        notes: null,
      } as TransactionRow;
      delete row.splits;
      data.transactions.push(row);
      return row;
    });

  beforeEach(() => {
    john = randomUUID();
    jane = randomUUID();
    seed = generateSeedData({ endDate: "2026-10-01", johnId: john, janeId: jane, months: 1 });
    data = memoryData(seed, TODAY);
    data.as(john);
  });

  it("puts back the transaction, the rule it learned and everything else it sorted", async () => {
    const [first, ...others] = waitingFrom("Fresh Corner Market", 4);
    const rulesBefore = data.rules.length;
    const result = await reviewTransaction({ id: first.id, kind: "spending", subcategoryId: groceries().id, always: true });
    expect(result).toMatchObject({ ok: true, alsoSorted: 3, summary: "Saved as Groceries. Sorted 3 more." });
    if (!result.ok) return;
    expect(data.rules.length).toBe(rulesBefore + 1);
    expect(others.every((row) => row.review_status === "auto_categorized")).toBe(true);

    expect(await undoReview({ operationId: result.operationId! })).toMatchObject({ ok: true });
    expect(data.rules.length).toBe(rulesBefore);
    for (const row of [first, ...others]) {
      expect(row).toMatchObject({ review_status: "needs_review", category_id: null, categorization_reason: "New merchant" });
    }
  });

  it("refuses, changing nothing, when someone edited one of them since", async () => {
    const [first, second] = waitingFrom("Fresh Corner Market", 2);
    const result = await reviewTransaction({ id: first.id, kind: "spending", subcategoryId: groceries().id, always: true });
    if (!result.ok) throw new Error(result.error);
    // Jane changes the other one afterwards.
    data.as(jane);
    await data.updateTransactions(seed.household.id, [second.id], { notes: "bought for the party" });
    data.as(john);
    const undo = await undoReview({ operationId: result.operationId! });
    expect(undo).toMatchObject({ ok: false });
    expect(!undo.ok && undo.error).toMatch(/isn't safe any more.*nothing was undone/i);
    expect(first.review_status).toBe("reviewed");
    expect(second).toMatchObject({ notes: "bought for the party", review_status: "auto_categorized" });
  });

  it("can only be done once, and only by the person who decided", async () => {
    const [first] = waitingFrom("Fresh Corner Market", 1);
    const result = await reviewTransaction({ id: first.id, kind: "spending", subcategoryId: groceries().id, always: false });
    if (!result.ok) throw new Error(result.error);
    data.as(jane);
    expect(await undoReview({ operationId: result.operationId! })).toMatchObject({ ok: false });
    data.as(john);
    expect(await undoReview({ operationId: result.operationId! })).toMatchObject({ ok: true });
    expect(await undoReview({ operationId: result.operationId! })).toMatchObject({ ok: false });
  });

  it("brings a split back when choosing one category had removed it", async () => {
    const [purchase] = waitingFrom("Target", 1);
    const home = seed.categories.find((c) => c.parent_id === null && c.name === "Housing")!;
    const homeSub = seed.categories.find((c) => c.parent_id === home.id)!;
    await data.saveSplits(seed.household.id, purchase.id, [
      { category_id: groceries().parent_id!, subcategory_id: groceries().id, amount: -15 },
      { category_id: home.id, subcategory_id: homeSub.id, amount: -5 },
    ]);
    const result = await reviewTransaction({ id: purchase.id, kind: "spending", subcategoryId: homeSub.id, always: false });
    if (!result.ok) throw new Error(result.error);
    expect(purchase.splits).toBeUndefined();
    expect(await undoReview({ operationId: result.operationId! })).toMatchObject({ ok: true });
    expect(purchase.splits?.map((part) => part.amount)).toEqual([-15, -5]);
  });

  it("keeps a private purchase's decision from teaching a rule, so undo has no rule to remove", async () => {
    const [gift] = waitingFrom("Jeweler", 1);
    gift.is_private = true;
    const rulesBefore = data.rules.length;
    const result = await reviewTransaction({ id: gift.id, kind: "spending", subcategoryId: groceries().id, always: true });
    if (!result.ok) throw new Error(result.error);
    expect(data.rules.length).toBe(rulesBefore);
    expect(data.operations.at(-1)!.rules).toEqual([]);
  });
});

describe("the undo function in the database", () => {
  let db: PGlite;
  let john: string;
  let jane: string;
  let seed: SeedData;
  let rowId: string;
  let otherId: string;

  const record = async (who: string) => {
    const rows = await db.query<{ id: string; updated_at: string }>(
      "select id, updated_at::text from public.transactions where id in ($1, $2)",
      [rowId, otherId],
    );
    const after = new Map(rows.rows.map((r) => [r.id, r.updated_at]));
    const before = {
      transaction_type: "expense",
      counterparty_id: null,
      category_id: null,
      subcategory_id: null,
      expense_type: null,
      review_status: "needs_review",
      categorization_confidence: "low",
      categorization_reason: "New merchant",
      notes: null,
    };
    const op = await asUser(db, who, (d) =>
      d.query<{ id: string }>(
        "insert into public.review_operations (household_id, summary, transactions) values ($1, 'Saved', $2::jsonb) returning id",
        [
          seed.household.id,
          JSON.stringify([
            { id: rowId, before, splits: null, after: after.get(rowId) },
            { id: otherId, before, splits: null, after: after.get(otherId) },
          ]),
        ],
      ),
    );
    return op.rows[0].id;
  };
  const decide = () =>
    db.query(
      "update public.transactions set review_status = 'reviewed', categorization_reason = 'Chosen during review' where id in ($1, $2)",
      [rowId, otherId],
    );
  const status = async () =>
    (await db.query<{ review_status: string }>("select review_status::text from public.transactions where id in ($1, $2)", [rowId, otherId])).rows.map(
      (r) => r.review_status,
    );

  beforeAll(async () => {
    db = await createTestDatabase();
    john = await createUser(db, "john@example.com", "John");
    jane = await createUser(db, "jane@example.com", "Jane");
    seed = generateSeedData({ endDate: "2026-10-01", johnId: john, janeId: jane, months: 1 });
    await insertSeed(db, seed);
    const card = seed.accounts.find((a) => a.owner_user_id === john && a.account_type === "credit_card")!;
    const insert = (hash: string) =>
      db.query<{ id: string }>(
        `insert into public.transactions (household_id, account_id, person_id, transaction_date, original_description, normalized_merchant, amount, source_hash)
         values ($1, $2, $3, '2026-09-28', 'SHOP', 'Shop', -9, $4) returning id`,
        [seed.household.id, card.id, john, hash],
      );
    rowId = (await insert("undo-1")).rows[0].id;
    otherId = (await insert("undo-2")).rows[0].id;
  });

  it("restores everything in one step", async () => {
    await decide();
    const op = await record(john);
    await asUser(db, john, (d) => d.query("select public.undo_review_operation($1)", [op]));
    expect(await status()).toEqual(["needs_review", "needs_review"]);
    await expect(asUser(db, john, (d) => d.query("select public.undo_review_operation($1)", [op]))).rejects.toThrow(/undo_gone/);
  });

  it("refuses and changes nothing if one row was edited since", async () => {
    await decide();
    const op = await record(john);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await asUser(db, jane, (d) => d.query("update public.transactions set notes = 'mine' where id = $1", [otherId]));
    await expect(asUser(db, john, (d) => d.query("select public.undo_review_operation($1)", [op]))).rejects.toThrow(/undo_conflict/);
    expect(await status()).toEqual(["reviewed", "reviewed"]);
  });

  it("is invisible to, and can't be undone by, the other person", async () => {
    await decide();
    const op = await record(john);
    expect((await asUser(db, jane, (d) => d.query("select id from public.review_operations"))).rows).toHaveLength(0);
    await expect(asUser(db, jane, (d) => d.query("select public.undo_review_operation($1)", [op]))).rejects.toThrow(/undo_gone/);
    await expect(
      asUser(db, jane, (d) =>
        d.query("insert into public.review_operations (household_id, user_id, summary) values ($1, $2, 'x')", [seed.household.id, john]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
