// Server-side half of the import: validates what the browser sent, then
// classifies, names the merchant and fingerprints each transaction.

import { createHash } from "node:crypto";
import { categorize, type RuleLike } from "@/lib/categories/rules";
import { isISODate } from "@/lib/dates";
import {
  TRANSACTION_TYPES,
  type AccountRow,
  type CategoryRow,
  type TransactionInsert,
  type TransactionType,
} from "@/lib/db/types";
import { countsAsSpending } from "@/lib/finance/summary";
import { toCents } from "@/lib/money";
import { isUuid } from "@/lib/params";
import { classifyTransaction, type AccountPeople } from "./classify";
import { normalizeMerchant } from "./merchant";
import { MAX_ROWS_PER_FILE } from "./parse-file";
import type { NormalizedTransaction } from "./types";

export const MAX_FILES_PER_IMPORT = 10;

export interface ImportFileInput {
  fileName: string;
  accountId: string;
  transactions: NormalizedTransaction[];
  /** the account balance shown at the end of the file, if the export has one */
  latestBalance?: { date: string; balance: number } | null;
}

/** A row ready to save; the database fills in id and timestamps. */
export type NewTransaction = Omit<TransactionInsert, "id" | "created_at" | "updated_at"> & {
  source_hash: string;
};

const text = (value: unknown, maxLength: number): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, maxLength) : null;

/** Never trust the browser: rebuild every row from validated primitives. */
export function validateImportInput(input: unknown): ImportFileInput[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_FILES_PER_IMPORT) return null;
  const files: ImportFileInput[] = [];
  for (const file of input) {
    if (typeof file !== "object" || file === null) return null;
    const { fileName, accountId, transactions, latestBalance } = file as Record<string, unknown>;
    if (typeof accountId !== "string" || !isUuid(accountId)) return null;
    if (!Array.isArray(transactions) || transactions.length > MAX_ROWS_PER_FILE) return null;

    const rows: NormalizedTransaction[] = [];
    for (const item of transactions) {
      if (typeof item !== "object" || item === null) return null;
      const row = item as Record<string, unknown>;
      const description = text(row.originalDescription, 250);
      const postingDate = row.postingDate ?? null;
      const typeHint = row.transactionTypeHint ?? null;
      if (
        typeof row.transactionDate !== "string" ||
        !isISODate(row.transactionDate) ||
        !(postingDate === null || (typeof postingDate === "string" && isISODate(postingDate))) ||
        !description ||
        typeof row.amount !== "number" ||
        !Number.isFinite(row.amount) ||
        Math.abs(row.amount) >= 1e9 ||
        !(typeHint === null || TRANSACTION_TYPES.includes(typeHint as TransactionType))
      ) {
        return null;
      }
      rows.push({
        transactionDate: row.transactionDate,
        postingDate: postingDate as string | null,
        originalDescription: description,
        amount: toCents(row.amount) / 100,
        transactionTypeHint: typeHint as TransactionType | null,
        sourceId: text(row.sourceId, 100),
        merchantHint: text(row.merchantHint, 100),
        bankCategory: text(row.bankCategory, 100),
      });
    }
    files.push({ fileName: safeFileName(fileName), accountId, transactions: rows, latestBalance: validBalance(latestBalance) });
  }
  return files;
}

function validBalance(value: unknown): { date: string; balance: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const { date, balance } = value as Record<string, unknown>;
  if (typeof date !== "string" || !isISODate(date)) return null;
  if (typeof balance !== "number" || !Number.isFinite(balance) || Math.abs(balance) >= 1e10) return null;
  return { date, balance: toCents(balance) / 100 };
}

/** File names sometimes embed account numbers; keep the name, drop long digit runs. */
export function safeFileName(name: unknown): string {
  const value = typeof name === "string" ? name : "";
  return value.replace(/\d{5,}/g, "…").replace(/[^\w .…()\-]/g, "").trim().slice(0, 80) || "upload.csv";
}

/**
 * Fingerprint used to recognize a transaction seen in an earlier upload.
 * Built from account, date, amount and the bank's reference (or description).
 * `occurrence` counts identical rows within one file, so two real purchases of
 * the same amount at the same place on the same day stay two transactions.
 */
export function fingerprint(
  accountId: string,
  transaction: NormalizedTransaction,
  occurrence: number,
): string {
  const identity =
    transaction.sourceId ?? transaction.originalDescription.toUpperCase().replace(/\s+/g, " ");
  const key = [accountId, transaction.transactionDate, toCents(transaction.amount), identity, occurrence];
  return createHash("sha256").update(key.join("|")).digest("hex");
}

export function buildTransactions(
  files: ImportFileInput[],
  accounts: AccountRow[],
  members: AccountPeople["members"],
  rules: RuleLike[] = [],
  categories: CategoryRow[] = [],
): NewTransaction[] {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const rows: NewTransaction[] = [];

  for (const file of files) {
    const account = accountsById.get(file.accountId);
    if (!account) throw new Error("Unknown account");
    const seen = new Map<string, number>();

    for (const transaction of file.transactions) {
      const base = fingerprint(account.id, transaction, 0);
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);

      const classification = classifyTransaction(transaction, account.account_type, {
        ownerId: account.owner_user_id,
        members,
      });
      const merchant = normalizeMerchant(transaction.originalDescription, transaction.merchantHint);
      const decision = categorize(
        {
          normalized_merchant: merchant,
          original_description: transaction.originalDescription,
          bank_category: transaction.bankCategory,
          transaction_type: classification.type,
        },
        rules,
        categories,
      );
      // An automatic rule settles spending only when we're also sure of the
      // type. Spending without a rule, and any uncertain type, waits for review.
      const typeIsCertain = classification.confidence === "high";
      const isSpending = countsAsSpending({ transaction_type: classification.type });
      const reviewStatus =
        decision && typeIsCertain
          ? decision.review_status
          : isSpending || !typeIsCertain
            ? "needs_review"
            : "auto_categorized";

      rows.push({
        household_id: account.household_id,
        account_id: account.id,
        person_id: account.owner_user_id,
        transaction_date: transaction.transactionDate,
        posting_date: transaction.postingDate,
        original_description: transaction.originalDescription,
        normalized_merchant: merchant,
        amount: transaction.amount,
        transaction_type: classification.type,
        counterparty_id: classification.counterpartyId ?? null,
        category_id: decision?.category_id ?? null,
        subcategory_id: decision?.subcategory_id ?? null,
        expense_type: decision?.expense_type ?? null,
        is_recurring: false,
        review_status: reviewStatus,
        categorization_confidence:
          decision && typeIsCertain ? decision.categorization_confidence : classification.confidence,
        categorization_reason: decision && typeIsCertain ? decision.categorization_reason : classification.reason,
        notes: null,
        source_file: file.fileName,
        source_hash: occurrence === 0 ? base : fingerprint(account.id, transaction, occurrence),
        bank_category: transaction.bankCategory,
        is_manual: false,
        awaiting_post: false,
        is_private: false,
        private_until: null,
      });
    }
  }
  return rows;
}

/** Splits rows into new ones and ones already saved (or repeated across the uploaded files). */
export function splitDuplicates(
  rows: NewTransaction[],
  existingHashes: Iterable<string>,
): { fresh: NewTransaction[]; duplicates: NewTransaction[] } {
  const known = new Set(existingHashes);
  const fresh: NewTransaction[] = [];
  const duplicates: NewTransaction[] = [];
  for (const row of rows) {
    if (known.has(row.source_hash)) duplicates.push(row);
    else {
      known.add(row.source_hash);
      fresh.push(row);
    }
  }
  return { fresh, duplicates };
}
