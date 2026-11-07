// Pairs hand-added entries with the bank's version of the same purchase when
// it finally shows up in an import, so it replaces the entry instead of
// being counted twice.

import { daysBetween } from "@/lib/dates";
import type { TransactionRow } from "@/lib/db/types";
import { toCents } from "@/lib/money";

/** The bank may date it a few days before (card authorized earlier) or a week after. */
export const MATCH_DAYS_BEFORE = 3;
export const MATCH_DAYS_AFTER = 7;
/** Allowed difference, as a share of the hand-entered amount (covers tips). */
export const MATCH_AMOUNT_TOLERANCE = 0.25;

type Entry = Pick<TransactionRow, "id" | "account_id" | "transaction_date" | "amount" | "awaiting_post">;
type Incoming = Pick<TransactionRow, "account_id" | "transaction_date" | "amount">;

/** How far apart two transactions are, or null when they can't be the same purchase. */
export function matchDistance(entry: Entry, incoming: Incoming): number | null {
  if (!entry.awaiting_post || entry.account_id !== incoming.account_id) return null;
  const days = daysBetween(entry.transaction_date, incoming.transaction_date);
  if (days < -MATCH_DAYS_BEFORE || days > MATCH_DAYS_AFTER) return null;
  const expected = toCents(entry.amount);
  const actual = toCents(incoming.amount);
  if (expected === 0 || Math.sign(expected) !== Math.sign(actual)) return null;
  const share = Math.abs(actual - expected) / Math.abs(expected);
  if (share > MATCH_AMOUNT_TOLERANCE + 1e-9) return null;
  // Amount matters most; a day apart counts about as much as a 2.5% difference.
  return share + Math.abs(days) * 0.025;
}

/**
 * For each incoming row (by index), the hand-added entry it replaces.
 * Closest pairs are matched first; each entry and each row is used once.
 */
export function matchManualEntries(entries: Entry[], incoming: Incoming[]): Map<number, string> {
  const pairs: { index: number; id: string; distance: number }[] = [];
  incoming.forEach((row, index) => {
    for (const entry of entries) {
      const distance = matchDistance(entry, row);
      if (distance !== null) pairs.push({ index, id: entry.id, distance });
    }
  });
  pairs.sort((a, b) => a.distance - b.distance || a.index - b.index);

  const matches = new Map<number, string>();
  const usedEntries = new Set<string>();
  for (const pair of pairs) {
    if (matches.has(pair.index) || usedEntries.has(pair.id)) continue;
    matches.set(pair.index, pair.id);
    usedEntries.add(pair.id);
  }
  return matches;
}

/**
 * What the hand-added row becomes once the bank's version arrives: the bank's
 * date, amount and description, and the person's own category, kind and note
 * when they gave one.
 */
export function mergeWithEntry<T extends Partial<TransactionRow>>(
  entry: Pick<TransactionRow, "category_id" | "subcategory_id" | "expense_type" | "transaction_type" | "review_status" | "notes" | "categorization_reason">,
  bank: T,
): Partial<TransactionRow> {
  const personDecided = entry.category_id !== null || entry.review_status === "reviewed";
  return {
    ...bank,
    is_manual: false,
    awaiting_post: false,
    notes: entry.notes ?? bank.notes ?? null,
    ...(personDecided
      ? {
          category_id: entry.category_id,
          subcategory_id: entry.subcategory_id,
          expense_type: entry.expense_type,
          transaction_type: entry.transaction_type,
          review_status: entry.review_status,
          categorization_confidence: "high",
          categorization_reason: entry.categorization_reason,
        }
      : {}),
  };
}
