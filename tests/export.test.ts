import { describe, expect, it } from "vitest";
import type { SplitRow, TransactionRow } from "@/lib/db/types";
import { buildBackup, exactAmount, ledgerCsv, restoreTransactions, validateBackup } from "@/lib/finance/export";
import { viewEntries, viewTotals } from "@/lib/finance/views";
import { generateSeedData } from "@/lib/seed/generate";

const seed = generateSeedData({ endDate: "2026-10-01", johnId: "11111111-1111-4111-8111-111111111111", janeId: "22222222-2222-4222-8222-222222222222", months: 2 });
const members = [
  { id: seed.members[0].user_id, name: "John" },
  { id: seed.members[1].user_id, name: "Jane" },
];

// One purchase split three ways, to the cent.
const purchase = seed.transactions.find((t) => t.transaction_type === "expense" && t.amount < -50)!;
const food = seed.categories.find((c) => c.parent_id === null && c.name === "Food")!;
const housing = seed.categories.find((c) => c.parent_id === null && c.name === "Housing")!;
const sub = (parent: { id: string }) => seed.categories.find((c) => c.parent_id === parent.id)!;
const totalCents = Math.round(purchase.amount * 100);
const firstCents = Math.trunc(totalCents / 3);
const parts: SplitRow[] = [
  [food, firstCents],
  [housing, firstCents],
  [food, totalCents - 2 * firstCents],
].map(([parent, cents], position) => ({
  id: `00000000-0000-4000-8000-00000000000${position}`,
  household_id: seed.household.id,
  transaction_id: purchase.id,
  position,
  category_id: (parent as { id: string }).id,
  subcategory_id: sub(parent as { id: string }).id,
  amount: (cents as number) / 100,
  note: null,
  refund_of_split_id: null,
  created_at: "",
}));
const transactions: TransactionRow[] = seed.transactions.map((row) => (row.id === purchase.id ? { ...row, splits: parts } : row));

describe("the transaction ledger", () => {
  const csv = ledgerCsv(transactions, { accounts: seed.accounts, categories: seed.categories, members });
  const lines = csv.trim().split("\r\n");
  const header = lines[0].split(",");
  const column = (name: string) => header.indexOf(name);

  it("writes exact cents, never rounded or in floating point", () => {
    expect(exactAmount(-12001)).toBe("-120.01");
    expect(exactAmount(5)).toBe("0.05");
    expect(exactAmount(-100)).toBe("-1.00");
    expect(lines.slice(1).every((line) => /,-?\d+\.\d{2},/.test(line))).toBe(true);
  });

  it("lists a split purchase as its parts, with the bank's full amount on each line", () => {
    const own = lines.filter((line) => line.startsWith(purchase.id));
    expect(own).toHaveLength(3);
    expect(own.map((line) => line.split(",")[column("part")])).toEqual(["1 of 3", "2 of 3", "3 of 3"]);
  });

  it("adds up to the app's spending total exactly", () => {
    // Simple CSV: no field in the seed contains a comma or quote.
    const spendingCents = lines
      .slice(1)
      .map((line) => line.split(","))
      .filter((cells) => cells[column("counts_as_spending")] === "yes")
      .reduce((total, cells) => total - Math.round(Number(cells[column("part_amount")]) * 100), 0);
    const options = { memberCount: 2, mode: "separate" as const, memberIds: members.map((m) => m.id) };
    expect(spendingCents).toBe(viewTotals(viewEntries(transactions, { kind: "everyone" }, options), { kind: "everyone" }).spendingCents);
  });

  it("can't smuggle a formula into a spreadsheet", () => {
    const evil = { ...seed.transactions[0], id: "x", normalized_merchant: "=HYPERLINK(\"http://x\")", notes: "+1+1", splits: undefined };
    const out = ledgerCsv([evil as TransactionRow], { accounts: seed.accounts, categories: seed.categories, members });
    expect(out).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(out).toContain("'+1+1");
  });
});

describe("the backup", () => {
  const backup = buildBackup({
    exported_at: "2026-10-01T12:00:00Z",
    exported_by: members[0],
    household: { id: seed.household.id, name: seed.household.name, review_starts_on: null, time_zone: "America/New_York" },
    members,
    accounts: seed.accounts,
    account_balances: seed.balances,
    account_coverage: seed.coverage,
    categories: seed.categories,
    categorization_rules: seed.rules,
    budget_lines: seed.budgets,
    income_sources: seed.incomeSources,
    recurring_overrides: [],
    transactions,
  });

  it("is versioned and says what it leaves out", () => {
    expect(backup).toMatchObject({ format: "household-finance-backup", version: 1 });
    expect(backup.privacy_note).toMatch(/private purchases/);
    expect(backup.transaction_splits).toHaveLength(3);
  });

  it("survives a round trip with every value and relationship intact", () => {
    const parsed = JSON.parse(JSON.stringify(backup));
    expect(validateBackup(parsed)).toEqual({ ok: true, problems: [], notes: [] });
    const restored = restoreTransactions(parsed);
    const withoutEmptySplits = transactions.map((row) => {
      if (row.splits) return row;
      const copy = { ...row };
      delete copy.splits;
      return copy;
    });
    expect(restored).toEqual(withoutEmptySplits);
    const options = { memberCount: 2, mode: "separate" as const, memberIds: members.map((m) => m.id) };
    for (const view of [{ kind: "everyone" as const }, { kind: "shared" as const }, { kind: "person" as const, personId: members[0].id }]) {
      expect(viewTotals(viewEntries(restored, view, options), view)).toEqual(viewTotals(viewEntries(transactions, view, options), view));
    }
  });

  it("notices a broken relationship or a split that no longer adds up", () => {
    const broken = JSON.parse(JSON.stringify(backup));
    broken.transactions[0].account_id = "99999999-9999-4999-8999-999999999999";
    broken.transaction_splits[0].amount = -1;
    const check = validateBackup(broken);
    expect(check.ok).toBe(false);
    expect(check.problems.join(" ")).toMatch(/unknown account/);
    expect(check.problems.join(" ")).toMatch(/don't add up/);
    expect(validateBackup({ format: "something else" }).ok).toBe(false);
  });

  it("notes, rather than rejects, a refund of a purchase left out for privacy", () => {
    const withRefund = JSON.parse(JSON.stringify(backup));
    withRefund.transactions[1].refund_of = "77777777-7777-4777-8777-777777777777";
    const check = validateBackup(withRefund);
    expect(check.ok).toBe(true);
    expect(check.notes).toHaveLength(1);
  });
});
