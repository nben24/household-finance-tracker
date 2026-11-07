import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { generateSeedData, type SeedData } from "@/lib/seed/generate";
import { asUser, createTestDatabase, createUser, insertSeed } from "./helpers/database";

let db: PGlite;
let john: string;
let jane: string;
let stranger: string;
let loner: string; // signed in but not in any household
let ours: SeedData;
let theirs: SeedData;

const HOUSEHOLD_TABLES = [
  "households",
  "household_members",
  "accounts",
  "categories",
  "categorization_rules",
  "budget_lines",
  "recurring_overrides",
  "account_balances",
  "income_sources",
  "transactions",
];

async function count(database: PGlite, table: string): Promise<number> {
  const result = await database.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
  return result.rows[0].n;
}

function newTransaction(householdId: string, accountId: string) {
  return [householdId, accountId, "2026-09-27", "TEST", "Test", -1];
}
const INSERT_TRANSACTION = `
  insert into public.transactions
    (household_id, account_id, transaction_date, original_description, normalized_merchant, amount)
  values ($1, $2, $3, $4, $5, $6)`;

beforeAll(async () => {
  db = await createTestDatabase();
  john = await createUser(db, "john@example.com", "John");
  jane = await createUser(db, "jane@example.com", "Jane");
  stranger = await createUser(db, "stranger@example.com", "Stranger");
  const strangerPartner = await createUser(db, "partner@example.com", "Partner");
  loner = await createUser(db, "loner@example.com", "Loner");

  ours = generateSeedData({ endDate: "2026-10-01", johnId: john, janeId: jane, months: 2 });
  theirs = generateSeedData({
    endDate: "2026-10-01",
    johnId: stranger,
    janeId: strangerPartner,
    months: 2,
    seed: 99,
    householdName: "Other Household",
  });
  await insertSeed(db, ours);
  await insertSeed(db, theirs);
});

describe("schema", () => {
  it("applies the migrations and accepts the full seed data set", async () => {
    expect(await count(db, "households")).toBe(2);
    expect(await count(db, "transactions")).toBe(ours.transactions.length + theirs.transactions.length);
  });

  it("creates a profile automatically for each new login", async () => {
    const result = await db.query<{ name: string; email: string }>(
      "select name, email from public.profiles where id = $1",
      [john],
    );
    expect(result.rows).toEqual([{ name: "John", email: "john@example.com" }]);
  });

  it("derives is_transfer from the transaction type", async () => {
    const result = await db.query<{ transaction_type: string; is_transfer: boolean }>(
      "select distinct transaction_type, is_transfer from public.transactions",
    );
    for (const row of result.rows) {
      expect(row.is_transfer, row.transaction_type).toBe(
        ["transfer", "credit_card_payment"].includes(row.transaction_type),
      );
    }
    await expect(
      db.query("update public.transactions set is_transfer = true where household_id = $1", [ours.household.id]),
    ).rejects.toThrow();
  });

  it("has no place to store full account or routing numbers", async () => {
    const result = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public'",
    );
    const columns = result.rows.map((row) => row.column_name);
    expect(columns.filter((name) => /number|routing|ssn|password|credential/.test(name))).toEqual([]);
    await expect(
      db.query("update public.accounts set last_four = '123456789' where household_id = $1", [ours.household.id]),
    ).rejects.toThrow();
  });

  it("rejects a transaction that points at another household's account", async () => {
    await expect(
      db.query(INSERT_TRANSACTION, newTransaction(ours.household.id, theirs.accounts[0].id)),
    ).rejects.toThrow(/foreign key/);
  });

  it("rejects another household's category, and a subcategory from the wrong category", async () => {
    const target = ours.transactions[0].id;
    await expect(
      db.query("update public.transactions set category_id = $1, subcategory_id = null where id = $2", [
        theirs.categories[0].id,
        target,
      ]),
    ).rejects.toThrow(/foreign key/);

    const food = ours.categories.find((c) => c.name === "Food")!;
    const mortgage = ours.categories.find((c) => c.name === "Mortgage")!;
    await expect(
      db.query("update public.transactions set category_id = $1, subcategory_id = $2 where id = $3", [
        food.id,
        mortgage.id,
        target,
      ]),
    ).rejects.toThrow(/foreign key/);
  });

  it("rejects assigning a transaction to someone outside the household", async () => {
    await expect(
      db.query("update public.transactions set person_id = $1 where id = $2", [stranger, ours.transactions[0].id]),
    ).rejects.toThrow(/foreign key/);
  });

  it("rejects a payback naming someone outside the household", async () => {
    await expect(
      db.query("update public.transactions set transaction_type = 'reimbursement', counterparty_id = $1 where id = $2", [
        stranger,
        ours.transactions[0].id,
      ]),
    ).rejects.toThrow(/foreign key/);
    const ok = await db.query(
      "update public.transactions set transaction_type = 'reimbursement', counterparty_id = $1 where id = $2",
      [jane, ours.transactions[0].id],
    );
    expect(ok.affectedRows).toBe(1);
  });

  it("rejects a rule pointing at another household's category, or a mismatched pair", async () => {
    const insertRule = (categoryId: string, subcategoryId: string) =>
      db.query(
        `insert into public.categorization_rules (household_id, match_type, pattern, category_id, subcategory_id)
         values ($1, 'merchant', 'test-' || gen_random_uuid(), $2, $3)`,
        [ours.household.id, categoryId, subcategoryId],
      );
    const theirFood = theirs.categories.find((c) => c.name === "Food")!;
    const theirGroceries = theirs.categories.find((c) => c.name === "Groceries")!;
    await expect(insertRule(theirFood.id, theirGroceries.id)).rejects.toThrow(/foreign key/);
    const food = ours.categories.find((c) => c.name === "Food")!;
    const mortgage = ours.categories.find((c) => c.name === "Mortgage")!;
    await expect(insertRule(food.id, mortgage.id)).rejects.toThrow(/foreign key/);
  });

  it("stores rule patterns lowercased, one per merchant", async () => {
    const food = ours.categories.find((c) => c.name === "Food")!;
    const groceries = ours.categories.find((c) => c.name === "Groceries")!;
    const insert = (pattern: string) =>
      db.query(
        `insert into public.categorization_rules (household_id, match_type, pattern, category_id, subcategory_id)
         values ($1, 'merchant', $2, $3, $4)`,
        [ours.household.id, pattern, food.id, groceries.id],
      );
    await expect(insert("Corner Bakery")).rejects.toThrow(/check/);
    await insert("corner bakery");
    await expect(insert("corner bakery")).rejects.toThrow(/unique/);
  });

  it("keeps categories to two levels", async () => {
    const subcategory = ours.categories.find((c) => c.parent_id !== null)!;
    await expect(
      db.query("insert into public.categories (household_id, parent_id, name) values ($1, $2, 'Too deep')", [
        ours.household.id,
        subcategory.id,
      ]),
    ).rejects.toThrow(/Subcategories/);
  });

  it("updates updated_at when a transaction changes", async () => {
    const id = ours.transactions[0].id;
    await db.query("update public.transactions set notes = 'edited' where id = $1", [id]);
    const result = await db.query<{ changed: boolean }>(
      "select updated_at > created_at as changed from public.transactions where id = $1",
      [id],
    );
    expect(result.rows[0].changed).toBe(true);
  });
});

describe("household isolation (Row Level Security)", () => {
  it("has RLS enabled on every table", async () => {
    const result = await db.query<{ relname: string }>(
      `select relname from pg_class
       where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`,
    );
    expect(result.rows).toEqual([]);
  });

  it("shows both partners the same household data", async () => {
    const seenByJohn = await asUser(db, john, (d) => count(d, "transactions"));
    const seenByJane = await asUser(db, jane, (d) => count(d, "transactions"));
    expect(seenByJohn).toBe(ours.transactions.length);
    expect(seenByJane).toBe(ours.transactions.length);
    expect(await asUser(db, jane, (d) => count(d, "accounts"))).toBe(ours.accounts.length);
    expect(await asUser(db, jane, (d) => count(d, "categories"))).toBe(ours.categories.length);
    expect(await asUser(db, jane, (d) => count(d, "categorization_rules"))).toBeGreaterThanOrEqual(ours.rules.length);
  });

  it("shows another household only its own data", async () => {
    await asUser(db, stranger, async (d) => {
      const result = await d.query<{ household_id: string }>(
        "select distinct household_id from public.transactions",
      );
      expect(result.rows).toEqual([{ household_id: theirs.household.id }]);
      expect(await count(d, "households")).toBe(1);
      expect(await count(d, "household_members")).toBe(2);
    });
  });

  it("shows nothing to someone signed in without a household", async () => {
    await asUser(db, loner, async (d) => {
      for (const table of HOUSEHOLD_TABLES) expect(await count(d, table), table).toBe(0);
      expect(await count(d, "profiles")).toBe(1); // only their own
    });
  });

  it("refuses signed-out visitors outright", async () => {
    await asUser(db, null, async (d) => {
      for (const table of [...HOUSEHOLD_TABLES, "profiles"]) {
        await expect(count(d, table), table).rejects.toThrow(/permission denied/);
      }
    });
  });

  it("only reveals profiles of people in the same household", async () => {
    await asUser(db, john, async (d) => {
      const result = await d.query<{ email: string }>("select email from public.profiles order by email");
      expect(result.rows.map((row) => row.email)).toEqual(["jane@example.com", "john@example.com"]);
    });
  });

  it("blocks writing into another household", async () => {
    await asUser(db, stranger, async (d) => {
      await expect(
        d.query(INSERT_TRANSACTION, newTransaction(ours.household.id, ours.accounts[0].id)),
      ).rejects.toThrow(/row-level security/);
      await expect(
        d.query("insert into public.accounts (household_id, institution, account_name, account_type) values ($1, 'X', 'X', 'checking')", [
          ours.household.id,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("makes another household's rows invisible to update and delete", async () => {
    const before = await count(db, "transactions");
    await asUser(db, stranger, async (d) => {
      const updated = await d.query("update public.transactions set notes = 'hacked' where household_id = $1", [
        ours.household.id,
      ]);
      const deleted = await d.query("delete from public.transactions where household_id = $1", [ours.household.id]);
      expect(updated.affectedRows).toBe(0);
      expect(deleted.affectedRows).toBe(0);
    });
    expect(await count(db, "transactions")).toBe(before);
  });

  it("blocks moving a transaction into another household", async () => {
    await asUser(db, stranger, async (d) => {
      await expect(
        d.query("update public.transactions set household_id = $1 where id = $2", [
          ours.household.id,
          theirs.transactions[0].id,
        ]),
      ).rejects.toThrow();
    });
  });

  it("does not let members add themselves or others to a household", async () => {
    await asUser(db, stranger, async (d) => {
      await expect(
        d.query("insert into public.household_members (household_id, user_id) values ($1, $2)", [
          ours.household.id,
          stranger,
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(d.query("insert into public.households (name) values ('Mine')")).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("lets a member edit their household's transactions and their own name only", async () => {
    await asUser(db, jane, async (d) => {
      const updated = await d.query("update public.transactions set notes = 'ok' where id = $1", [
        ours.transactions[1].id,
      ]);
      expect(updated.affectedRows).toBe(1);
      await d.query(INSERT_TRANSACTION, newTransaction(ours.household.id, ours.accounts[0].id));

      const renamed = await d.query("update public.profiles set name = 'Mika' where id = $1", [jane]);
      expect(renamed.affectedRows).toBe(1);
      const other = await d.query("update public.profiles set name = 'Nope' where id = $1", [john]);
      expect(other.affectedRows).toBe(0);
      await expect(
        d.query("update public.profiles set email = 'x@example.com' where id = $1", [jane]),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe("import fingerprints", () => {
  const insertWithHash = (accountId: string, hash: string | null) =>
    db.query(
      `insert into public.transactions
         (household_id, account_id, transaction_date, original_description, normalized_merchant, amount, source_hash)
       values ($1, $2, '2026-09-27', 'TEST', 'Test', -1, $3)`,
      [ours.household.id, accountId, hash],
    );

  it("refuses the same fingerprint twice on one account", async () => {
    await insertWithHash(ours.accounts[0].id, "abc");
    await expect(insertWithHash(ours.accounts[0].id, "abc")).rejects.toThrow(/unique/);
  });

  it("allows the same fingerprint on another account, and any number without one", async () => {
    await insertWithHash(ours.accounts[1].id, "abc");
    await insertWithHash(ours.accounts[0].id, null);
    await insertWithHash(ours.accounts[0].id, null);
  });

  it("skips duplicates quietly when saving with on-conflict-do-nothing, as the app does", async () => {
    const result = await db.query(
      `insert into public.transactions
         (household_id, account_id, transaction_date, original_description, normalized_merchant, amount, source_hash)
       values ($1, $2, '2026-09-27', 'TEST', 'Test', -1, 'abc'), ($1, $2, '2026-09-27', 'TEST', 'Test', -1, 'new')
       on conflict (account_id, source_hash) do nothing`,
      [ours.household.id, ours.accounts[0].id],
    );
    expect(result.affectedRows).toBe(1);
  });
});

describe("budget lines", () => {
  const insertLine = (values: Record<string, unknown>) => {
    const food = ours.categories.find((c) => c.name === "Food")!;
    const row = {
      household_id: ours.household.id,
      scope: "everyone",
      person_id: null,
      category_id: food.id,
      subcategory_id: null,
      amount: 100,
      starts_month: "2026-09-01",
      ...values,
    };
    const columns = Object.keys(row);
    return db.query(
      `insert into public.budget_lines (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      Object.values(row),
    );
  };

  it("requires a person for personal budgets, and only for them", async () => {
    await expect(insertLine({ scope: "person" })).rejects.toThrow(/check/);
    await expect(insertLine({ scope: "everyone", person_id: john })).rejects.toThrow(/check/);
    await insertLine({ scope: "person", person_id: john });
  });

  it("rejects someone outside the household, negative amounts and mid-month starts", async () => {
    await expect(insertLine({ scope: "person", person_id: stranger })).rejects.toThrow(/foreign key/);
    await expect(insertLine({ amount: -5 })).rejects.toThrow(/check/);
    await expect(insertLine({ starts_month: "2026-09-15" })).rejects.toThrow(/check/);
    await expect(insertLine({ starts_month: "2026-09-01", ends_month: "2026-08-01" })).rejects.toThrow(/check/);
  });

  it("rejects another household's category", async () => {
    const theirFood = theirs.categories.find((c) => c.name === "Food")!;
    await expect(insertLine({ category_id: theirFood.id })).rejects.toThrow(/foreign key/);
  });

  it("keeps each household's budgets to itself", async () => {
    const seen = await asUser(db, stranger, (d) => count(d, "budget_lines"));
    expect(seen).toBe(theirs.budgets.length);
    await asUser(db, stranger, async (d) => {
      const deleted = await d.query("delete from public.budget_lines where household_id = $1", [ours.household.id]);
      expect(deleted.affectedRows).toBe(0);
    });
  });
});

describe("household settings", () => {
  it("lets a member set the review start date, but nothing else about the household", async () => {
    await asUser(db, jane, async (d) => {
      const updated = await d.query("update public.households set review_starts_on = '2026-09-27' where id = $1", [
        ours.household.id,
      ]);
      expect(updated.affectedRows).toBe(1);
      await expect(
        d.query("update public.households set name = 'Renamed' where id = $1", [ours.household.id]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("does not let another household change it", async () => {
    await asUser(db, stranger, async (d) => {
      const updated = await d.query("update public.households set review_starts_on = '2020-01-01' where id = $1", [
        ours.household.id,
      ]);
      expect(updated.affectedRows).toBe(0);
    });
  });

  it("accepts rules marked as suggested by AI", async () => {
    const food = ours.categories.find((c) => c.name === "Food")!;
    const restaurants = ours.categories.find((c) => c.name === "Restaurants")!;
    await db.query(
      `insert into public.categorization_rules (household_id, match_type, pattern, category_id, subcategory_id, auto_apply, source)
       values ($1, 'merchant', 'ai test bakery', $2, $3, true, 'ai')`,
      [ours.household.id, food.id, restaurants.id],
    );
  });
});

describe("hand-added transactions", () => {
  it("only lets a hand-added entry wait to post", async () => {
    const id = ours.transactions[2].id;
    await expect(db.query("update public.transactions set awaiting_post = true where id = $1", [id])).rejects.toThrow(/check/);
    const ok = await db.query("update public.transactions set is_manual = true, awaiting_post = true where id = $1", [id]);
    expect(ok.affectedRows).toBe(1);
  });
});

describe("recurring overrides", () => {
  it("are private to the household and need a valid status", async () => {
    await db.query("insert into public.recurring_overrides (household_id, recurring_key, status) values ($1, 'netflix|charge|shared', 'stopped')", [ours.household.id]);
    await expect(
      db.query("insert into public.recurring_overrides (household_id, recurring_key, status) values ($1, 'x', 'maybe')", [ours.household.id]),
    ).rejects.toThrow();
    expect(await asUser(db, stranger, (d) => count(d, "recurring_overrides"))).toBe(0);
    expect(await asUser(db, jane, (d) => count(d, "recurring_overrides"))).toBe(1);
  });
});

describe("account balances", () => {
  const insert = (accountId: string, asOf: string, amount: number, householdId = ours.household.id) =>
    db.query("insert into public.account_balances (household_id, account_id, as_of, balance) values ($1, $2, $3, $4)", [
      householdId,
      accountId,
      asOf,
      amount,
    ]);

  it("keeps one balance per account per day", async () => {
    await insert(ours.accounts[0].id, "2026-01-15", 100);
    await expect(insert(ours.accounts[0].id, "2026-01-15", 200)).rejects.toThrow(/unique/);
  });

  it("refuses a balance for another household's account", async () => {
    await expect(insert(theirs.accounts[0].id, "2026-01-15", 100)).rejects.toThrow(/foreign key/);
  });

  it("keeps each household's balances to itself", async () => {
    expect(await asUser(db, stranger, (d) => count(d, "account_balances"))).toBe(theirs.balances.length);
    await asUser(db, stranger, async (d) => {
      const deleted = await d.query("delete from public.account_balances where household_id = $1", [ours.household.id]);
      expect(deleted.affectedRows).toBe(0);
    });
  });

  it("accepts the new kinds of account", async () => {
    await db.query(
      "insert into public.accounts (household_id, institution, account_name, account_type) values ($1, 'Home', 'House', 'property'), ($1, 'Lender', 'Car loan', 'loan')",
      [ours.household.id],
    );
  });
});

describe("private transactions", () => {
  // A purchase of John's on his own card, made private.
  let giftId: string;
  const card = () => ours.accounts.find((a) => a.owner_user_id === john && a.account_type === "credit_card")!;

  beforeAll(async () => {
    const result = await db.query<{ id: string }>(
      `insert into public.transactions
         (household_id, account_id, person_id, transaction_date, original_description, normalized_merchant, amount, source_hash)
       values ($1, $2, $3, '2026-09-20', 'TIFFANY & CO', 'Tiffany & Co', -150, 'gift-hash')
       returning id`,
      [ours.household.id, card().id, john],
    );
    giftId = result.rows[0].id;
  });

  const seenBy = async (userId: string) =>
    asUser(db, userId, async (d) => (await d.query("select id from public.transactions where id = $1", [giftId])).rows.length);

  it("only the person can make their own purchase private", async () => {
    await asUser(db, jane, async (d) => {
      await expect(
        d.query("update public.transactions set is_private = true where id = $1", [giftId]),
      ).rejects.toThrow(/row-level security/);
    });
    await asUser(db, john, async (d) => {
      const updated = await d.query("update public.transactions set is_private = true where id = $1", [giftId]);
      expect(updated.affectedRows).toBe(1);
    });
  });

  it("hides it completely from the other person, but not from its owner", async () => {
    expect(await seenBy(john)).toBe(1);
    expect(await seenBy(jane)).toBe(0);
  });

  it("leaves it out of the other person's totals, so nothing gives it away", async () => {
    const total = (userId: string) =>
      asUser(db, userId, async (d) => {
        const result = await d.query<{ total: string }>(
          "select coalesce(sum(amount), 0)::text as total from public.transactions where household_id = $1 and normalized_merchant = 'Tiffany & Co'",
          [ours.household.id],
        );
        return Number(result.rows[0].total);
      });
    expect(await total(john)).toBe(-150);
    expect(await total(jane)).toBe(0);
  });

  it("can't be changed or deleted by the other person", async () => {
    await asUser(db, jane, async (d) => {
      expect((await d.query("update public.transactions set notes = 'peek' where id = $1", [giftId])).affectedRows).toBe(0);
      expect((await d.query("delete from public.transactions where id = $1", [giftId])).affectedRows).toBe(0);
    });
    expect(await seenBy(john)).toBe(1);
  });

  it("doesn't break the other person's import of the same transaction", async () => {
    // If the same row arrives in an import by the other person, it's skipped as a duplicate.
    await asUser(db, jane, async (d) => {
      const result = await d.query(
        `insert into public.transactions
           (household_id, account_id, transaction_date, original_description, normalized_merchant, amount, source_hash)
         values ($1, $2, '2026-09-20', 'TIFFANY & CO', 'Tiffany & Co', -150, 'gift-hash')
         on conflict (account_id, source_hash) do nothing`,
        [ours.household.id, card().id],
      );
      expect(result.affectedRows).toBe(0);
    });
  });

  it("shows it to everyone again from its reveal date", async () => {
    await asUser(db, john, (d) => d.query("update public.transactions set private_until = current_date where id = $1", [giftId]));
    expect(await seenBy(jane)).toBe(1);
    await asUser(db, john, (d) =>
      d.query("update public.transactions set private_until = current_date + 30 where id = $1", [giftId]),
    );
    expect(await seenBy(jane)).toBe(0);
  });

  it("can't be used on a shared transaction, which has no owner", async () => {
    const shared = ours.transactions.find((t) => t.person_id === null)!;
    await expect(db.query("update public.transactions set is_private = true where id = $1", [shared.id])).rejects.toThrow(/check/);
  });

  it("is still invisible to other households either way", async () => {
    expect(await seenBy(stranger)).toBe(0);
  });
});

describe("expected income", () => {
  const insert = (values: Record<string, unknown>) => {
    const row = { household_id: ours.household.id, person_id: john, name: "Paycheck", amount: 2400, frequency: "monthly", anchor_date: "2026-10-06", second_day: null, ...values };
    const columns = Object.keys(row);
    return db.query(
      `insert into public.income_sources (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      Object.values(row),
    );
  };

  it("needs the second payday exactly for twice-a-month pay", async () => {
    await insert({ frequency: "semimonthly", second_day: 21 });
    await expect(insert({ frequency: "semimonthly", second_day: null })).rejects.toThrow(/check/);
    await expect(insert({ frequency: "monthly", second_day: 21 })).rejects.toThrow(/check/);
  });

  it("refuses zero amounts and people outside the household", async () => {
    await expect(insert({ amount: 0 })).rejects.toThrow(/check/);
    await expect(insert({ person_id: stranger })).rejects.toThrow(/foreign key/);
  });

  it("is private to the household", async () => {
    expect(await asUser(db, stranger, (d) => count(d, "income_sources"))).toBe(0);
    expect(await asUser(db, jane, (d) => count(d, "income_sources"))).toBe(1);
  });
});

