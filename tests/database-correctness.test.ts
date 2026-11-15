// Database checks for the correctness and privacy fixes: the household
// calendar used by privacy rules, private entries that post, account closing
// dates, budget changes in one step, and account coverage.

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { mergeWithEntry } from "@/lib/import/manual-match";
import { generateSeedData, type SeedData } from "@/lib/seed/generate";
import { applyMigrations, asUser, createTestDatabase, createUser, insertSeed } from "./helpers/database";

let db: PGlite;
let john: string;
let jane: string;
let stranger: string;
let ours: SeedData;
let theirs: SeedData;

beforeAll(async () => {
  db = await createTestDatabase();
  john = await createUser(db, "john@example.com", "John");
  jane = await createUser(db, "jane@example.com", "Jane");
  stranger = await createUser(db, "stranger@example.com", "Stranger");
  const partner = await createUser(db, "partner@example.com", "Partner");
  ours = generateSeedData({ endDate: "2026-10-01", johnId: john, janeId: jane, months: 2 });
  theirs = generateSeedData({ endDate: "2026-10-01", johnId: stranger, janeId: partner, months: 2, seed: 7, householdName: "Other" });
  await insertSeed(db, ours);
  await insertSeed(db, theirs);
});

const johnsCard = () => ours.accounts.find((a) => a.owner_user_id === john && a.account_type === "credit_card")!;

describe("the household calendar", () => {
  const dateAt = async (zone: string, at: string) => {
    await db.query("update public.households set time_zone = $1 where id = $2", [zone, ours.household.id]);
    const result = await db.query<{ day: string }>("select public.household_today($1, $2::timestamptz)::text as day", [
      ours.household.id,
      at,
    ]);
    return result.rows[0].day;
  };

  it("turns over at local midnight, through daylight saving changes", async () => {
    expect(await dateAt("America/New_York", "2026-11-14T04:59:59Z")).toBe("2026-11-13");
    expect(await dateAt("America/New_York", "2026-11-14T05:00:00Z")).toBe("2026-11-14");
    expect(await dateAt("America/New_York", "2026-03-08T04:59:59Z")).toBe("2026-03-07");
    expect(await dateAt("America/New_York", "2026-03-08T05:00:00Z")).toBe("2026-03-08");
    expect(await dateAt("America/New_York", "2026-11-01T03:59:59Z")).toBe("2026-10-31");
    expect(await dateAt("America/New_York", "2026-11-01T04:00:00Z")).toBe("2026-11-01");
    await db.query("update public.households set time_zone = 'America/New_York' where id = $1", [ours.household.id]);
  });

  it("refuses a time zone that doesn't exist", async () => {
    await expect(
      db.query("update public.households set time_zone = 'Mars/Olympus' where id = $1", [ours.household.id]),
    ).rejects.toThrow(/time zone/i);
  });

  it("lets a member change the household's time zone but not its name", async () => {
    await asUser(db, jane, async (d) => {
      const result = await d.query("update public.households set time_zone = 'America/Chicago' where id = $1", [ours.household.id]);
      expect(result.affectedRows).toBe(1);
      await expect(d.query("update public.households set name = 'x' where id = $1", [ours.household.id])).rejects.toThrow(/permission/);
    });
    await db.query("update public.households set time_zone = 'America/New_York' where id = $1", [ours.household.id]);
  });

  it("reveals a private purchase from midnight on its date in the household's own time zone", async () => {
    // Kiritimati (UTC+14) and Pago Pago (UTC−11) are always on different dates,
    // so "today in Kiritimati" is always tomorrow in Pago Pago.
    const gift = await db.query<{ id: string }>(
      `insert into public.transactions
         (household_id, account_id, person_id, transaction_date, original_description, normalized_merchant, amount,
          is_private, private_until)
       values ($1, $2, $3, '2026-09-20', 'GIFT SHOP', 'Gift Shop', -80, true,
               public.household_today(null, now()) + 0)
       returning id`,
      [ours.household.id, johnsCard().id, john],
    );
    const id = gift.rows[0].id;
    const kiritimatiToday = (
      await db.query<{ day: string }>("select (now() at time zone 'Pacific/Kiritimati')::date::text as day")
    ).rows[0].day;
    await db.query("update public.transactions set private_until = $1 where id = $2", [kiritimatiToday, id]);
    const janeSees = async () =>
      asUser(db, jane, async (d) => (await d.query("select id from public.transactions where id = $1", [id])).rows.length);

    await db.query("update public.households set time_zone = 'Pacific/Kiritimati' where id = $1", [ours.household.id]);
    expect(await janeSees()).toBe(1); // it's that date there: revealed
    await db.query("update public.households set time_zone = 'Pacific/Pago_Pago' where id = $1", [ours.household.id]);
    expect(await janeSees()).toBe(0); // still the day before there: hidden
    // The owner always sees it.
    expect(await asUser(db, john, async (d) => (await d.query("select id from public.transactions where id = $1", [id])).rows.length)).toBe(1);
    await db.query("update public.households set time_zone = 'America/New_York' where id = $1", [ours.household.id]);
  });
});

describe("a private hand-added purchase when the bank's version arrives", () => {
  let entryId: string;

  beforeAll(async () => {
    const result = await asUser(db, john, (d) =>
      d.query<{ id: string }>(
        `insert into public.transactions
           (household_id, account_id, person_id, transaction_date, original_description, normalized_merchant, amount,
            transaction_type, review_status, is_manual, awaiting_post, is_private, private_until, notes,
            category_id, subcategory_id)
         values ($1, $2, $3, '2026-09-26', 'Jeweler', 'Jeweler', -150, 'expense', 'reviewed', true, true, true,
                 '2027-02-14', 'Valentine''s present', null, null)
         returning id`,
        [ours.household.id, johnsCard().id, john],
      ),
    );
    entryId = result.rows[0].id;
  });

  it("is replaced by the bank row and stays private, with its reveal date", async () => {
    const entry = (await asUser(db, john, (d) => d.query("select * from public.transactions where id = $1", [entryId]))).rows[0] as Record<
      string,
      unknown
    >;
    // What an import builds for the same purchase: never private.
    const bankRow = {
      transaction_date: "2026-09-27",
      amount: -152.5,
      original_description: "JEWELER #42 NEW YORK",
      normalized_merchant: "Jeweler",
      source_hash: "jeweler-hash",
      is_private: false,
      private_until: null,
    };
    const merged = mergeWithEntry(entry as never, bankRow);
    await asUser(db, john, async (d) => {
      const result = await d.query(
        `update public.transactions
            set transaction_date = $2, amount = $3, original_description = $4, source_hash = $5,
                is_manual = $6, awaiting_post = $7, is_private = $8, private_until = $9, notes = $10
          where id = $1 and is_manual and awaiting_post`,
        [
          entryId,
          merged.transaction_date,
          merged.amount,
          merged.original_description,
          merged.source_hash,
          merged.is_manual,
          merged.awaiting_post,
          merged.is_private,
          merged.private_until,
          merged.notes,
        ],
      );
      expect(result.affectedRows).toBe(1);
    });
    const after = (await db.query<Record<string, unknown>>("select * from public.transactions where id = $1", [entryId])).rows[0];
    expect(after).toMatchObject({ is_private: true, is_manual: false, awaiting_post: false, notes: "Valentine's present" });
    expect(String(after.private_until)).toContain("2027");
  });

  it("is still invisible to the other person, row and totals", async () => {
    await asUser(db, jane, async (d) => {
      expect((await d.query("select id from public.transactions where id = $1", [entryId])).rows).toHaveLength(0);
      const total = await d.query<{ n: number }>(
        "select count(*)::int as n from public.transactions where source_hash = 'jeweler-hash'",
      );
      expect(total.rows[0].n).toBe(0);
    });
  });

  it("makes the other person's later import of the same row a quiet duplicate", async () => {
    await asUser(db, jane, async (d) => {
      const result = await d.query(
        `insert into public.transactions
           (household_id, account_id, transaction_date, original_description, normalized_merchant, amount, source_hash)
         values ($1, $2, '2026-09-27', 'JEWELER #42 NEW YORK', 'Jeweler', -152.5, 'jeweler-hash')
         on conflict (account_id, source_hash) do nothing`,
        [ours.household.id, johnsCard().id],
      );
      expect(result.affectedRows).toBe(0);
    });
  });
});

describe("closing dates on accounts", () => {
  it("can only be set on a retired account", async () => {
    const account = ours.accounts.find((a) => a.account_type === "property")!;
    await expect(db.query("update public.accounts set closed_on = '2026-09-01' where id = $1", [account.id])).rejects.toThrow(/check/);
    await db.query("update public.accounts set is_active = false, closed_on = '2026-09-01' where id = $1", [account.id]);
    await db.query("update public.accounts set is_active = true, closed_on = null where id = $1", [account.id]);
  });
});

describe("budget changes in one step", () => {
  const groceries = () => {
    const parent = ours.categories.find((c) => c.parent_id === null && c.name === "Food")!;
    return { categoryId: parent.id, subcategoryId: ours.categories.find((c) => c.parent_id === parent.id)!.id };
  };
  const lines = (where: string, params: unknown[]) =>
    db.query<{ id: string; starts_month: string; ends_month: string | null; amount: string }>(
      `select id, starts_month::text, ends_month::text, amount::text from public.budget_lines where ${where} order by starts_month`,
      params,
    );
  let lineId: string;

  beforeAll(async () => {
    const { categoryId, subcategoryId } = groceries();
    // Clear any seed budgets for this category so the tests start clean.
    await db.query("delete from public.budget_lines where category_id = $1", [categoryId]);
    lineId = (
      await asUser(db, john, (d) =>
        d.query<{ id: string }>(
          "select public.create_budget_line($1, 'person', $2, $3, $4, 'variable', 400, '2026-07-01') as id",
          [ours.household.id, john, categoryId, subcategoryId],
        ),
      )
    ).rows[0].id;
  });

  it("refuses a second budget that would count the same spending", async () => {
    const { categoryId } = groceries();
    await asUser(db, jane, async (d) => {
      await expect(
        d.query("select public.create_budget_line($1, 'everyone', null, $2, null, 'variable', 900, '2026-08-01')", [
          ours.household.id,
          categoryId,
        ]),
      ).rejects.toThrow(/budget_conflict/);
    });
  });

  it("refuses a personal and a shared budget for the same category in split mode only", async () => {
    const { categoryId, subcategoryId } = groceries();
    await asUser(db, jane, async (d) => {
      await expect(
        d.query("select public.create_budget_line($1, 'shared', null, $2, $3, 'variable', 300, '2026-08-01', true)", [
          ours.household.id,
          categoryId,
          subcategoryId,
        ]),
      ).rejects.toThrow(/budget_conflict/);
    });
  });

  it("ends the old version and starts the new one together; earlier months keep theirs", async () => {
    await asUser(db, john, (d) => d.query("select public.change_budget_line($1, '2026-09-01', 450, 'variable')", [lineId]));
    const { categoryId } = groceries();
    const rows = (await lines("category_id = $1", [categoryId])).rows;
    expect(rows).toEqual([
      { id: lineId, starts_month: "2026-07-01", ends_month: "2026-08-01", amount: "400.00" },
      expect.objectContaining({ starts_month: "2026-09-01", ends_month: null, amount: "450.00" }),
    ]);
  });

  it("changes nothing at all when the new version can't be saved", async () => {
    const { categoryId } = groceries();
    const before = (await lines("category_id = $1", [categoryId])).rows;
    const current = before[before.length - 1].id;
    await asUser(db, john, async (d) => {
      await expect(d.query("select public.change_budget_line($1, '2026-10-01', -5, 'variable')", [current])).rejects.toThrow(/check/);
    });
    expect((await lines("category_id = $1", [categoryId])).rows).toEqual(before);
  });

  it("refuses a change based on a version someone already replaced", async () => {
    // The July version ended in August, so a change from October (made on a stale screen) is refused.
    await asUser(db, jane, async (d) => {
      await expect(d.query("select public.change_budget_line($1, '2026-10-01', 999, 'variable')", [lineId])).rejects.toThrow(
        /budget_stale/,
      );
    });
  });

  it("lets two people's changes take turns instead of both ending the same line", async () => {
    const { categoryId } = groceries();
    const current = (await lines("category_id = $1 and ends_month is null", [categoryId])).rows[0].id;
    await asUser(db, john, (d) => d.query("select public.change_budget_line($1, '2026-11-01', 500, 'variable')", [current]));
    // Jane's screen still shows the September version as current.
    await asUser(db, jane, async (d) => {
      await expect(d.query("select public.change_budget_line($1, '2026-11-01', 520, 'variable')", [current])).rejects.toThrow(
        /budget_stale/,
      );
    });
    const open = (await lines("category_id = $1 and ends_month is null", [categoryId])).rows;
    expect(open).toHaveLength(1);
    expect(open[0].amount).toBe("500.00");
  });

  it("removes a version from a month on, and is invisible to other households", async () => {
    const { categoryId } = groceries();
    const current = (await lines("category_id = $1 and ends_month is null", [categoryId])).rows[0].id;
    await asUser(db, stranger, async (d) => {
      await expect(d.query("select public.end_budget_line($1, '2026-12-01')", [current])).rejects.toThrow(/budget_not_found/);
      await expect(d.query("select public.change_budget_line($1, '2026-12-01', 1, 'variable')", [current])).rejects.toThrow(
        /budget_not_found/,
      );
      await expect(
        d.query("select public.create_budget_line($1, 'everyone', null, $2, null, 'variable', 1, '2026-12-01')", [
          ours.household.id,
          categoryId,
        ]),
      ).rejects.toThrow(/budget_not_found/);
    });
    await asUser(db, john, (d) => d.query("select public.end_budget_line($1, '2026-12-01')", [current]));
    expect((await lines("id = $1", [current])).rows[0].ends_month).toBe("2026-11-01");
  });
});

describe("account coverage", () => {
  it("is shared with the household and invisible to anyone else", async () => {
    const mine = await asUser(db, jane, (d) => d.query("select id from public.account_coverage where household_id = $1", [ours.household.id]));
    expect(mine.rows.length).toBe(ours.coverage.length);
    const others = await asUser(db, stranger, (d) =>
      d.query("select id from public.account_coverage where household_id = $1", [ours.household.id]),
    );
    expect(others.rows).toHaveLength(0);
  });

  it("can't be recorded against another household's account", async () => {
    await asUser(db, stranger, async (d) => {
      await expect(
        d.query(
          "insert into public.account_coverage (household_id, account_id, covered_from, covered_through) values ($1, $2, '2026-09-01', '2026-09-30')",
          [theirs.household.id, johnsCard().id],
        ),
      ).rejects.toThrow();
    });
  });

  it("is estimated for accounts imported before coverage was tracked, never from private purchases", async () => {
    const older = await createTestDatabase({ before: "20261013000000" });
    const a = await createUser(older, "a@example.com", "A");
    const b = await createUser(older, "b@example.com", "B");
    const seed = generateSeedData({ endDate: "2026-10-01", johnId: a, janeId: b, months: 2 });
    await insertSeed(older, seed, { coverage: false });
    // A private purchase dated after everything else must not stretch the estimate.
    const card = seed.accounts.find((x) => x.owner_user_id === a && x.account_type === "credit_card")!;
    await older.query(
      `insert into public.transactions (household_id, account_id, person_id, transaction_date, original_description, normalized_merchant, amount, is_private)
       values ($1, $2, $3, '2026-12-24', 'SECRET', 'Secret', -10, true)`,
      [seed.household.id, card.id, a],
    );
    await applyMigrations(older, { from: "20261013000000" });
    const rows = (
      await older.query<{ account_id: string; covered_through: string; source: string }>(
        "select account_id, covered_through::text, source::text from public.account_coverage",
      )
    ).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.source === "estimated")).toBe(true);
    expect(rows.every((row) => row.covered_through <= "2026-10-01")).toBe(true);
  });
});

describe("import records", () => {
  it("belong to the person who imported, and tag the rows they saved", async () => {
    const batchId = "11111111-2222-4333-8444-555555555555";
    await asUser(db, john, (d) =>
      d.query("insert into public.import_batches (id, household_id, file_count) values ($1, $2, 1)", [batchId, ours.household.id]),
    );
    await asUser(db, john, (d) =>
      d.query(
        `insert into public.transactions
           (household_id, account_id, transaction_date, original_description, normalized_merchant, amount, source_hash, import_batch_id)
         values ($1, $2, '2026-09-28', 'CAFE', 'Cafe', -4, 'batch-hash', $3)
         on conflict (account_id, source_hash) do nothing`,
        [ours.household.id, johnsCard().id, batchId],
      ),
    );
    // Only John sees his import's record (its counts include his private purchases).
    expect((await asUser(db, john, (d) => d.query("select id from public.import_batches"))).rows).toHaveLength(1);
    expect((await asUser(db, jane, (d) => d.query("select id from public.import_batches"))).rows).toHaveLength(0);
    // Jane can't claim it, or mark it finished.
    await asUser(db, jane, async (d) => {
      expect((await d.query("update public.import_batches set status = 'sorted' where id = $1", [batchId])).affectedRows).toBe(0);
      await expect(
        d.query("insert into public.import_batches (id, household_id, user_id) values (gen_random_uuid(), $1, $2)", [
          ours.household.id,
          john,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
    // A retry with the same id finds the existing record instead of creating another.
    await asUser(db, john, (d) =>
      d.query("insert into public.import_batches (id, household_id) values ($1, $2) on conflict (id) do nothing", [batchId, ours.household.id]),
    );
    expect((await db.query("select id from public.import_batches where id = $1", [batchId])).rows).toHaveLength(1);
    const tagged = await asUser(db, jane, (d) => d.query("select id from public.transactions where import_batch_id = $1", [batchId]));
    expect(tagged.rows).toHaveLength(1);
  });
});
