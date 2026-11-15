// Split purchases: one bank transaction divided between categories, counted
// once (as its parts) in every total, and refunds that reverse chosen parts.

import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { allocationsOf, isSplit } from "@/lib/finance/allocations";
import { budgetProgress } from "@/lib/finance/budgets";
import { buildReport, monthlyPeriods } from "@/lib/finance/report";
import { spendingByCategory, spendingByPerson } from "@/lib/finance/summary";
import { entriesByCategory, viewEntries, viewTotals, type View } from "@/lib/finance/views";
import type { TransactionRow } from "@/lib/db/types";
import { generateSeedData, type SeedData } from "@/lib/seed/generate";
import { asUser, createTestDatabase, createUser, insertSeed } from "./helpers/database";
import { memoryData, type MemoryData } from "./helpers/memory-data";

// ---------------------------------------------------------------------------
// The money: every total counts the parts, once
// ---------------------------------------------------------------------------

const part = (id: string, category_id: string, subcategory_id: string, amount: number) => ({
  id,
  household_id: "h",
  transaction_id: "target",
  position: 0,
  category_id,
  subcategory_id,
  amount,
  note: null,
  refund_of_split_id: null,
  created_at: "",
});

const base = {
  id: "target",
  transaction_date: "2026-10-10",
  transaction_type: "expense" as const,
  person_id: "n",
  counterparty_id: null,
  review_status: "reviewed" as const,
  original_description: "TARGET 1234",
  bank_category: null,
};
const target = {
  ...base,
  amount: -120.01,
  category_id: "food",
  subcategory_id: "groceries",
  splits: [part("p1", "food", "groceries", -80.0), part("p2", "home", "supplies", -30.01), part("p3", "gifts", "gifts", -10)],
};
const sharedTarget = { ...target, id: "shared", person_id: null };
const categories = [
  { id: "food", name: "Food" },
  { id: "home", name: "Home" },
  { id: "gifts", name: "Gifts" },
];
const options = { memberCount: 2, mode: "separate" as const, memberIds: ["n", "m"] };

describe("a split purchase in the totals", () => {
  it("is divided into its parts, adding up exactly to the bank amount", () => {
    expect(isSplit(target)).toBe(true);
    expect(allocationsOf(target).map((a) => a.cents)).toEqual([-8000, -3001, -1000]);
    expect(allocationsOf(target).reduce((sum, a) => sum + a.cents, 0)).toBe(-12001);
  });

  it("counts whole when its parts don't add up (never double, never lost)", () => {
    const broken = { ...target, splits: target.splits.slice(0, 2) };
    expect(isSplit(broken)).toBe(false);
    expect(allocationsOf(broken)).toEqual([{ cents: -12001, categoryId: "food", subcategoryId: "groceries" }]);
  });

  it("puts each part in its own category, and the total is the bank amount once", () => {
    const entries = viewEntries([target], { kind: "everyone" }, options);
    expect(entriesByCategory(entries, categories).map((c) => [c.id, c.cents])).toEqual([
      ["food", 8000],
      ["home", 3001],
      ["gifts", 1000],
    ]);
    expect(viewTotals(entries, { kind: "everyone" }).spendingCents).toBe(12001);
    expect(spendingByCategory([target], categories).map((c) => c.cents)).toEqual([8000, 3001, 1000]);
    // Who paid is unchanged by a split.
    expect(spendingByPerson([target], [{ id: "n", name: "N" }])).toEqual([{ id: "n", name: "N", cents: 12001, count: 1 }]);
  });

  it("reconciles Everyone = each person + Shared, including split mode, to the cent", () => {
    for (const mode of ["separate", "split"] as const) {
      const opts = { ...options, mode };
      const rows = [target, sharedTarget];
      const spend = (view: View) => viewTotals(viewEntries(rows, view, opts), view).spendingCents;
      const everyone = spend({ kind: "everyone" });
      const people = spend({ kind: "person", personId: "n" }) + spend({ kind: "person", personId: "m" });
      expect(everyone).toBe(24002);
      if (mode === "separate") expect(people + spend({ kind: "shared" })).toBe(everyone);
      else expect(people).toBe(everyone); // shared spending divided between the two, in whole cents
    }
  });

  it("is measured by budgets as its parts", () => {
    const line = {
      id: "l",
      scope: "everyone" as const,
      person_id: null,
      category_id: "home",
      subcategory_id: null,
      kind: "variable" as const,
      amount: 50,
      starts_month: "2026-10-01",
      ends_month: null,
    };
    const entries = viewEntries([target], { kind: "everyone" }, options);
    const [progress] = budgetProgress([line], () => entries, "2026-10");
    expect(progress.spentCents).toBe(3001);
  });

  it("shows up in reports as its parts", () => {
    const entries = viewEntries([target], { kind: "everyone" }, options);
    const report = buildReport(entries, monthlyPeriods("2026-10", 1), categories, "category", { kind: "everyone" });
    expect(report.rows.map((row) => [row.id, row.total])).toEqual([
      ["food", 8000],
      ["home", 3001],
      ["gifts", 1000],
    ]);
    expect(report.spending).toEqual([12001]);
  });

  it("is reduced part by part by a refund of chosen parts", () => {
    const refund = {
      ...base,
      id: "refund",
      transaction_type: "refund" as const,
      amount: 25,
      category_id: "home",
      subcategory_id: "supplies",
      splits: [part("r1", "home", "supplies", 15), part("r2", "gifts", "gifts", 10)],
    };
    const entries = viewEntries([target, refund], { kind: "everyone" }, options);
    expect(entriesByCategory(entries, categories).map((c) => [c.id, c.cents])).toEqual([
      ["food", 8000],
      ["home", 1501],
    ]);
    expect(viewTotals(entries, { kind: "everyone" }).spendingCents).toBe(9501);
  });
});

// ---------------------------------------------------------------------------
// The database: one-step saves, exact totals, privacy that follows the purchase
// ---------------------------------------------------------------------------

describe("split purchases in the database", () => {
  let db: PGlite;
  let john: string;
  let jane: string;
  let seed: SeedData;
  let purchaseId: string;
  let food: { category: string; sub: string };
  let home: { category: string; sub: string };

  const pick = (name: string) => {
    const category = seed.categories.find((c) => c.parent_id === null && c.name === name)!;
    return { category: category.id, sub: seed.categories.find((c) => c.parent_id === category.id)!.id };
  };
  const save = (who: string, id: string, parts: object[]) =>
    asUser(db, who, (d) => d.query("select public.save_transaction_splits($1, $2::jsonb)", [id, JSON.stringify(parts)]));
  const parts = () => [
    { category_id: food.category, subcategory_id: food.sub, amount: -80 },
    { category_id: home.category, subcategory_id: home.sub, amount: -40.01 },
  ];

  beforeAll(async () => {
    db = await createTestDatabase();
    john = await createUser(db, "john@example.com", "John");
    jane = await createUser(db, "jane@example.com", "Jane");
    seed = generateSeedData({ endDate: "2026-10-01", johnId: john, janeId: jane, months: 1 });
    await insertSeed(db, seed);
    food = pick("Food");
    home = pick("Housing");
    const card = seed.accounts.find((a) => a.owner_user_id === john && a.account_type === "credit_card")!;
    purchaseId = (
      await db.query<{ id: string }>(
        `insert into public.transactions
           (household_id, account_id, person_id, transaction_date, original_description, normalized_merchant, amount, source_hash)
         values ($1, $2, $3, '2026-09-25', 'TARGET 1234', 'Target', -120.01, 'target-hash') returning id`,
        [seed.household.id, card.id, john],
      )
    ).rows[0].id;
  });

  it("saves parts that add up exactly, leaving the bank transaction as it was", async () => {
    await save(jane, purchaseId, parts());
    const row = (await db.query<Record<string, unknown>>("select * from public.transactions where id = $1", [purchaseId])).rows[0];
    expect(row).toMatchObject({ amount: "-120.01", source_hash: "target-hash", category_id: food.category, review_status: "reviewed" });
    const saved = await db.query<{ amount: string }>(
      "select amount::text from public.transaction_splits where transaction_id = $1 order by position",
      [purchaseId],
    );
    expect(saved.rows.map((r) => r.amount)).toEqual(["-80.00", "-40.01"]);
  });

  it("refuses parts that are a cent off, have the wrong sign, or stand alone — changing nothing", async () => {
    const before = await db.query("select id from public.transaction_splits where transaction_id = $1", [purchaseId]);
    const wrongTotal = [...parts().slice(0, 1), { ...parts()[1], amount: -40 }];
    await expect(save(john, purchaseId, wrongTotal)).rejects.toThrow(/split_total/);
    await expect(save(john, purchaseId, [{ ...parts()[0], amount: 80 }, { ...parts()[1], amount: -200.01 }])).rejects.toThrow(/split_sign/);
    await expect(save(john, purchaseId, [{ ...parts()[0], amount: -120.01 }])).rejects.toThrow(/split_count/);
    const after = await db.query("select id from public.transaction_splits where transaction_id = $1", [purchaseId]);
    expect(after.rows).toEqual(before.rows);
  });

  it("is private exactly when its purchase is", async () => {
    await db.query("update public.transactions set is_private = true where id = $1", [purchaseId]);
    const seen = (who: string) =>
      asUser(db, who, async (d) => (await d.query("select id from public.transaction_splits where transaction_id = $1", [purchaseId])).rows.length);
    expect(await seen(john)).toBe(2);
    expect(await seen(jane)).toBe(0);
    await expect(save(jane, purchaseId, [])).rejects.toThrow(/split_not_found/);
    expect(await seen(john)).toBe(2);
    await db.query("update public.transactions set is_private = false where id = $1", [purchaseId]);
    expect(await seen(jane)).toBe(2);
  });

  it("can't be attached to another household's transaction", async () => {
    const stranger = await createUser(db, "s@example.com", "S");
    await asUser(db, stranger, async (d) => {
      await expect(
        d.query(
          "insert into public.transaction_splits (household_id, transaction_id, category_id, amount) values ($1, $2, $3, -1)",
          [seed.household.id, purchaseId, food.category],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("is removed, and the purchase goes back to review, when its amount changes", async () => {
    await db.query("update public.transactions set amount = -125 where id = $1", [purchaseId]);
    const left = await db.query("select id from public.transaction_splits where transaction_id = $1", [purchaseId]);
    expect(left.rows).toHaveLength(0);
    const row = (await db.query<{ review_status: string }>("select review_status::text from public.transactions where id = $1", [purchaseId])).rows[0];
    expect(row.review_status).toBe("needs_review");
  });

  it("can't link a purchase as a refund of something", async () => {
    await expect(db.query("update public.transactions set refund_of = $1 where id = $1", [purchaseId])).rejects.toThrow(/check/);
  });
});

// ---------------------------------------------------------------------------
// The actions: what a person types
// ---------------------------------------------------------------------------

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

const { saveSplit, linkRefund } = await import("@/app/(app)/transactions/actions");

describe("splitting from the transaction page", () => {
  let seed: SeedData;
  let john: string;
  let jane: string;
  const sub = (name: string) => {
    const parent = seed.categories.find((c) => c.parent_id === null && c.name === name)!;
    return seed.categories.find((c) => c.parent_id === parent.id)!;
  };
  const addRow = (amount: number, type: "expense" | "refund", extra: Record<string, unknown> = {}) => {
    const row = {
      ...seed.transactions[0],
      id: randomUUID(),
      account_id: seed.accounts.find((a) => a.owner_user_id === john && a.account_type === "credit_card")!.id,
      person_id: john,
      transaction_date: "2026-10-10",
      normalized_merchant: "Target",
      original_description: "TARGET",
      amount,
      transaction_type: type,
      is_private: false,
      private_until: null,
      ...extra,
    } as TransactionRow;
    delete row.splits;
    data.transactions.push(row);
    return row;
  };

  beforeEach(() => {
    john = randomUUID();
    jane = randomUUID();
    seed = generateSeedData({ endDate: "2026-10-01", johnId: john, janeId: jane, months: 1 });
    data = memoryData(seed, TODAY);
    data.as(john);
  });

  it("explains exactly how far off the parts are", async () => {
    const row = addRow(-120.01, "expense");
    const result = await saveSplit({
      id: row.id,
      parts: [
        { subcategoryId: sub("Food").id, amount: "80" },
        { subcategoryId: sub("Housing").id, amount: "40" },
      ],
    });
    expect(result).toEqual({
      ok: false,
      error: "The parts add up to $120.00; they need to add up to $120.01 ($0.01 still to divide).",
    });
    expect(row.splits).toBeUndefined();
  });

  it("saves parts typed as positive amounts with the purchase's sign", async () => {
    const row = addRow(-120.01, "expense");
    const result = await saveSplit({
      id: row.id,
      parts: [
        { subcategoryId: sub("Food").id, amount: "80.00" },
        { subcategoryId: sub("Housing").id, amount: "$40.01", note: "light bulbs" },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    expect(row.splits!.map((p) => p.amount)).toEqual([-80, -40.01]);
    expect(row.splits![1].note).toBe("light bulbs");
  });

  it("links a partial refund to the parts it reverses", async () => {
    const purchase = addRow(-120.01, "expense");
    await saveSplit({
      id: purchase.id,
      parts: [
        { subcategoryId: sub("Food").id, amount: "80" },
        { subcategoryId: sub("Housing").id, amount: "40.01" },
      ],
    });
    const refund = addRow(25, "refund", { transaction_date: "2026-10-15" });
    const [foodPart, homePart] = purchase.splits!;
    const tooMuch = await linkRefund({ refundId: refund.id, originalId: purchase.id, parts: [{ splitId: homePart.id, amount: "41" }] });
    expect(tooMuch).toMatchObject({ ok: false });
    const result = await linkRefund({
      refundId: refund.id,
      originalId: purchase.id,
      parts: [
        { splitId: foodPart.id, amount: "10" },
        { splitId: homePart.id, amount: "15" },
      ],
    });
    expect(result).toMatchObject({ ok: true });
    expect(refund.refund_of).toBe(purchase.id);
    expect(refund.splits!.map((p) => [p.category_id, p.amount, p.refund_of_split_id])).toEqual([
      [foodPart.category_id, 10, foodPart.id],
      [homePart.category_id, 15, homePart.id],
    ]);
  });

  it("makes the refund of a private purchase private too", async () => {
    const purchase = addRow(-60, "expense", { is_private: true, private_until: "2026-12-25", category_id: sub("Gifts").parent_id, subcategory_id: sub("Gifts").id });
    const refund = addRow(60, "refund", { transaction_date: "2026-10-12" });
    expect(await linkRefund({ refundId: refund.id, originalId: purchase.id })).toMatchObject({ ok: true });
    expect(refund).toMatchObject({ is_private: true, private_until: "2026-12-25", refund_of: purchase.id, subcategory_id: sub("Gifts").id });
    data.as(jane);
    expect(await data.getTransaction(seed.household.id, refund.id)).toBeNull();
  });
});
