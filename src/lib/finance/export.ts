// Exports: an exact-cent transaction ledger (CSV) and a versioned backup
// (JSON). Both are built from what the signed-in person can see, through the
// same permissions as every page, so the other person's unrevealed private
// purchases are never included.

import type {
  AccountBalanceRow,
  AccountCoverageRow,
  AccountRow,
  BudgetLineRow,
  CategorizationRuleRow,
  CategoryRow,
  HouseholdRow,
  IncomeSourceRow,
  RecurringOverrideRow,
  SplitRow,
  TransactionRow,
} from "@/lib/db/types";
import { toCents } from "@/lib/money";
import { allocationsOf, isSplit } from "./allocations";
import { csvCell } from "./report";
import { countsAsSpending } from "./summary";

/** Exact amount text from cents: -1234 → "-12.34". */
export function exactAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const text = (value: string | null | undefined) => csvCell(value ?? "");

export const LEDGER_COLUMNS = [
  "transaction_id",
  "date",
  "posting_date",
  "account",
  "account_owner",
  "person",
  "merchant",
  "bank_description",
  "type",
  "category",
  "subcategory",
  "transaction_amount",
  "part",
  "part_amount",
  "counts_as_spending",
  "refund_of",
  "review_status",
  "added_by_hand",
  "private",
  "notes",
] as const;

/**
 * One line per transaction, or per part of a split purchase. `part_amount`
 * is what that line contributes; summing it over lines where
 * counts_as_spending is "yes" gives the app's spending totals exactly
 * (negated). `transaction_amount` is always the bank's full amount.
 */
export function ledgerCsv(
  rows: TransactionRow[],
  lookups: { accounts: AccountRow[]; categories: CategoryRow[]; members: { id: string; name: string }[] },
): string {
  const accounts = new Map(lookups.accounts.map((account) => [account.id, account]));
  const categories = new Map(lookups.categories.map((category) => [category.id, category.name]));
  const people = new Map(lookups.members.map((member) => [member.id, member.name]));
  const personName = (id: string | null) => (id ? (people.get(id) ?? "") : "Shared");
  const lines = [LEDGER_COLUMNS.join(",")];
  const sorted = [...rows].sort((a, b) => a.transaction_date.localeCompare(b.transaction_date) || a.id.localeCompare(b.id));
  for (const row of sorted) {
    const account = accounts.get(row.account_id);
    const parts = allocationsOf(row);
    parts.forEach((part, index) => {
      lines.push(
        [
          text(row.id),
          text(row.transaction_date),
          text(row.posting_date),
          text(account ? `${account.institution} ${account.account_name}` : ""),
          text(account ? personName(account.owner_user_id) : ""),
          text(personName(row.person_id)),
          text(row.normalized_merchant),
          text(row.original_description),
          text(row.transaction_type),
          text(part.categoryId ? (categories.get(part.categoryId) ?? "") : ""),
          text(part.subcategoryId ? (categories.get(part.subcategoryId) ?? "") : ""),
          exactAmount(toCents(row.amount)),
          isSplit(row) ? `${index + 1} of ${parts.length}` : "",
          exactAmount(part.cents),
          countsAsSpending(row) ? "yes" : "no",
          text(row.refund_of ?? ""),
          text(row.review_status),
          row.is_manual ? "yes" : "no",
          row.is_private ? "yes" : "no",
          text(row.notes),
        ].join(","),
      );
    });
  }
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export const BACKUP_FORMAT = "household-finance-backup";
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exported_at: string;
  exported_by: { id: string; name: string };
  privacy_note: string;
  household: Pick<HouseholdRow, "id" | "name" | "review_starts_on" | "time_zone">;
  members: { id: string; name: string }[];
  accounts: AccountRow[];
  account_balances: AccountBalanceRow[];
  account_coverage: AccountCoverageRow[];
  categories: CategoryRow[];
  categorization_rules: CategorizationRuleRow[];
  budget_lines: BudgetLineRow[];
  income_sources: IncomeSourceRow[];
  recurring_overrides: RecurringOverrideRow[];
  transactions: Omit<TransactionRow, "splits">[];
  transaction_splits: SplitRow[];
}

export const BACKUP_PRIVACY_NOTE =
  "This backup contains what the person who downloaded it could see. The other person's private purchases that " +
  "haven't been revealed yet are not included (and neither are their splits), so a backup from each of you can differ.";

export function buildBackup(input: Omit<Backup, "format" | "version" | "privacy_note" | "transactions" | "transaction_splits"> & {
  transactions: TransactionRow[];
}): Backup {
  const splits = input.transactions.flatMap((row) => row.splits ?? []);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    privacy_note: BACKUP_PRIVACY_NOTE,
    ...input,
    transactions: input.transactions.map((row) => {
      const copy: Partial<TransactionRow> = { ...row };
      delete copy.splits;
      return copy as Omit<TransactionRow, "splits">;
    }),
    transaction_splits: splits,
  };
}

export interface BackupCheck {
  ok: boolean;
  problems: string[];
  /** references to rows left out for privacy (e.g. a refund of the other person's private purchase) */
  notes: string[];
}

/** Checks a parsed backup's shape and that every relationship in it holds. */
export function validateBackup(value: unknown): BackupCheck {
  const problems: string[] = [];
  const notes: string[] = [];
  const backup = value as Partial<Backup> | null;
  if (!backup || typeof backup !== "object") return { ok: false, problems: ["Not a backup file."], notes };
  if (backup.format !== BACKUP_FORMAT) problems.push("Unknown file format.");
  if (typeof backup.version !== "number" || backup.version > BACKUP_VERSION) problems.push("Unsupported backup version.");
  const lists = [
    "members",
    "accounts",
    "account_balances",
    "account_coverage",
    "categories",
    "categorization_rules",
    "budget_lines",
    "income_sources",
    "recurring_overrides",
    "transactions",
    "transaction_splits",
  ] as const;
  for (const key of lists) if (!Array.isArray(backup[key])) problems.push(`Missing ${key}.`);
  if (problems.length > 0) return { ok: false, problems, notes };
  const b = backup as Backup;

  const ids = (rows: { id: string }[], name: string) => {
    const set = new Set<string>();
    for (const row of rows) {
      if (set.has(row.id)) problems.push(`Duplicate id in ${name}.`);
      set.add(row.id);
    }
    return set;
  };
  const members = new Set(b.members.map((m) => m.id));
  const accounts = ids(b.accounts, "accounts");
  const categories = ids(b.categories, "categories");
  const transactions = ids(b.transactions, "transactions");
  ids(b.transaction_splits, "transaction_splits");
  const refOk = (set: Set<string>, id: string | null | undefined) => id === null || id === undefined || set.has(id);

  for (const account of b.accounts) if (!refOk(members, account.owner_user_id)) problems.push(`Account ${account.id} has an unknown owner.`);
  for (const category of b.categories) if (!refOk(categories, category.parent_id)) problems.push(`Category ${category.id} has an unknown parent.`);
  for (const row of b.transactions) {
    if (!accounts.has(row.account_id)) problems.push(`Transaction ${row.id} has an unknown account.`);
    if (!refOk(categories, row.category_id) || !refOk(categories, row.subcategory_id)) problems.push(`Transaction ${row.id} has an unknown category.`);
    if (!refOk(members, row.person_id)) problems.push(`Transaction ${row.id} has an unknown person.`);
    if (row.refund_of && !transactions.has(row.refund_of)) notes.push(`Transaction ${row.id} refunds a purchase not in this backup.`);
    if (!/^-?\d+(\.\d{1,2})?$/.test(String(row.amount))) problems.push(`Transaction ${row.id} has an inexact amount.`);
  }
  const partsByTransaction = new Map<string, number>();
  for (const part of b.transaction_splits) {
    if (!transactions.has(part.transaction_id)) problems.push(`Split part ${part.id} belongs to a transaction not in this backup.`);
    if (!categories.has(part.category_id) || !refOk(categories, part.subcategory_id)) problems.push(`Split part ${part.id} has an unknown category.`);
    partsByTransaction.set(part.transaction_id, (partsByTransaction.get(part.transaction_id) ?? 0) + toCents(part.amount));
  }
  const byId = new Map(b.transactions.map((row) => [row.id, row]));
  for (const [id, cents] of partsByTransaction) {
    const row = byId.get(id);
    if (row && toCents(row.amount) !== cents) problems.push(`Split parts of ${id} don't add up to its amount.`);
  }
  for (const balance of b.account_balances) if (!accounts.has(balance.account_id)) problems.push(`A balance has an unknown account.`);
  for (const period of b.account_coverage) if (!accounts.has(period.account_id)) problems.push(`A coverage period has an unknown account.`);
  for (const rule of b.categorization_rules) {
    if (!categories.has(rule.category_id) || !categories.has(rule.subcategory_id)) problems.push(`Rule ${rule.pattern} has an unknown category.`);
  }
  for (const line of b.budget_lines) {
    if (!categories.has(line.category_id) || !refOk(categories, line.subcategory_id)) problems.push(`A budget has an unknown category.`);
    if (!refOk(members, line.person_id)) problems.push(`A budget has an unknown person.`);
  }
  return { ok: problems.length === 0, problems, notes };
}

/** Transactions from a backup with their split parts attached again. */
export function restoreTransactions(backup: Backup): TransactionRow[] {
  const parts = new Map<string, SplitRow[]>();
  for (const part of backup.transaction_splits) {
    parts.set(part.transaction_id, [...(parts.get(part.transaction_id) ?? []), part]);
  }
  return backup.transactions.map((row) => {
    const own = parts.get(row.id);
    return { ...row, ...(own ? { splits: own.sort((a, b) => a.position - b.position) } : {}) } as TransactionRow;
  });
}
