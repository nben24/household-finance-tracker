// Pairs hand-added entries with the bank's version of the same purchase when
// it finally shows up in an import, so it replaces the entry instead of
// being counted twice.
//
// Account, date and amount decide whether a pair is possible at all. The
// merchant name is supporting evidence only: a typed "Diner" and the bank's
// "TST* LOCAL DINER 123" are the same place, but two unrelated $40 charges on
// the same card can be too. A pair is "strong" (replaced automatically) only
// when the names agree and neither side has another candidate; anything else
// is "possible" and waits for the person to say "Same purchase" or
// "Keep separate".

import { daysBetween } from "@/lib/dates";
import type { TransactionRow } from "@/lib/db/types";
import { toCents } from "@/lib/money";

/** The bank may date it a few days before (card authorized earlier) or a week after. */
export const MATCH_DAYS_BEFORE = 3;
export const MATCH_DAYS_AFTER = 7;
/** Allowed difference, as a share of the hand-entered amount (covers tips). */
export const MATCH_AMOUNT_TOLERANCE = 0.25;
/** Share of the shorter name's words the other name must contain for the names to "agree". */
export const MERCHANT_AGREEMENT = 0.5;

type Entry = Pick<TransactionRow, "id" | "account_id" | "transaction_date" | "amount" | "awaiting_post"> &
  Partial<Pick<TransactionRow, "normalized_merchant">>;
type Incoming = Pick<TransactionRow, "account_id" | "transaction_date" | "amount"> &
  Partial<Pick<TransactionRow, "normalized_merchant">>;

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

const STOP_WORDS = new Set(["the", "and", "inc", "llc", "co", "store", "shop", "purchase", "pos", "debit", "card"]);

function words(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word)),
  );
}

/**
 * 0–1: the share of the shorter name's words found in the other name
 * ("Diner" vs "Local Diner" = 1). A word counts when one starts with the
 * other, so "starbuck" and "starbucks" agree. 0 when either name is empty.
 */
export function merchantSimilarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  const [shorter, longer] = left.size <= right.size ? [left, right] : [right, left];
  let shared = 0;
  for (const word of shorter) {
    if ([...longer].some((other) => other === word || other.startsWith(word) || word.startsWith(other))) shared += 1;
  }
  return shared / shorter.size;
}

export type MatchStrength = "strong" | "possible";

export interface MatchProposal {
  /** index into the incoming rows */
  index: number;
  entryId: string;
  distance: number;
  strength: MatchStrength;
  /** 0–1, see merchantSimilarity */
  merchantSimilarity: number;
  /** how many other pairings were possible for this entry or this row */
  alternatives: number;
}

/**
 * For each incoming row, the hand-added entry it most likely replaces.
 * Closest pairs are matched first; each entry and each row is used once.
 */
export function proposeMatches(entries: Entry[], incoming: Incoming[]): MatchProposal[] {
  const pairs: { index: number; id: string; distance: number }[] = [];
  const perEntry = new Map<string, number>();
  const perRow = new Map<number, number>();
  incoming.forEach((row, index) => {
    for (const entry of entries) {
      const distance = matchDistance(entry, row);
      if (distance === null) continue;
      pairs.push({ index, id: entry.id, distance });
      perEntry.set(entry.id, (perEntry.get(entry.id) ?? 0) + 1);
      perRow.set(index, (perRow.get(index) ?? 0) + 1);
    }
  });
  pairs.sort((a, b) => a.distance - b.distance || a.index - b.index);

  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const proposals: MatchProposal[] = [];
  const usedEntries = new Set<string>();
  const usedRows = new Set<number>();
  for (const pair of pairs) {
    if (usedRows.has(pair.index) || usedEntries.has(pair.id)) continue;
    usedRows.add(pair.index);
    usedEntries.add(pair.id);
    const similarity = merchantSimilarity(
      entriesById.get(pair.id)?.normalized_merchant ?? "",
      incoming[pair.index].normalized_merchant ?? "",
    );
    const alternatives = (perEntry.get(pair.id) ?? 1) - 1 + ((perRow.get(pair.index) ?? 1) - 1);
    proposals.push({
      index: pair.index,
      entryId: pair.id,
      distance: pair.distance,
      merchantSimilarity: similarity,
      alternatives,
      strength: similarity >= MERCHANT_AGREEMENT && alternatives === 0 ? "strong" : "possible",
    });
  }
  return proposals.sort((a, b) => a.index - b.index);
}

/** Every incoming row (by index) → the entry it replaces, ignoring strength. Kept for callers that only need pairs. */
export function matchManualEntries(entries: Entry[], incoming: Incoming[]): Map<number, string> {
  return new Map(proposeMatches(entries, incoming).map((proposal) => [proposal.index, proposal.entryId]));
}

/** The person's answer about one proposed pair, identified by entry id and the bank row's fingerprint. */
export interface MatchDecision {
  entryId: string;
  sourceHash: string;
  same: boolean;
}

/**
 * Which pairs to actually replace, given the person's answers. Re-checks every
 * answer against the current data: an accepted pair is used only if it still
 * fits (same account, close in date and amount, entry still waiting).
 *
 * - "Same purchase" answers are applied first, so they win over guesses.
 * - Strong proposals are applied automatically unless the person said "Keep separate".
 * - Possible proposals are applied only when the person said "Same purchase".
 */
export function decideMatches(
  entries: Entry[],
  incoming: (Incoming & { source_hash: string })[],
  decisions: MatchDecision[],
): Map<number, string> {
  const rejected = new Set(decisions.filter((d) => !d.same).map((d) => `${d.entryId}|${d.sourceHash}`));
  const accepted = decisions.filter((d) => d.same);
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const result = new Map<number, string>();
  const usedEntries = new Set<string>();

  for (const decision of accepted) {
    const entry = entriesById.get(decision.entryId);
    const index = incoming.findIndex((row, i) => row.source_hash === decision.sourceHash && !result.has(i));
    if (!entry || index === -1 || usedEntries.has(entry.id)) continue;
    if (matchDistance(entry, incoming[index]) === null) continue;
    result.set(index, entry.id);
    usedEntries.add(entry.id);
  }

  const remainingEntries = entries.filter((entry) => !usedEntries.has(entry.id));
  const remainingIndexes = incoming.map((_, index) => index).filter((index) => !result.has(index));
  const proposals = proposeMatches(
    remainingEntries,
    remainingIndexes.map((index) => incoming[index]),
  );
  for (const proposal of proposals) {
    const index = remainingIndexes[proposal.index];
    if (proposal.strength !== "strong") continue;
    if (rejected.has(`${proposal.entryId}|${incoming[index].source_hash}`)) continue;
    result.set(index, proposal.entryId);
  }
  return result;
}

type EntryDecisions = Pick<
  TransactionRow,
  | "category_id"
  | "subcategory_id"
  | "expense_type"
  | "transaction_type"
  | "review_status"
  | "notes"
  | "categorization_reason"
> &
  Partial<Pick<TransactionRow, "is_private" | "private_until">>;

/**
 * What the hand-added row becomes once the bank's version arrives: the bank's
 * date, amount and description, and the person's own decisions: category,
 * kind and note when they gave one, and always their privacy choice and
 * reveal date (a bank row never carries those, so it must not reset them).
 */
export function mergeWithEntry<T extends Partial<TransactionRow>>(
  entry: EntryDecisions,
  bank: T,
): Partial<TransactionRow> {
  const personDecided = entry.category_id !== null || entry.review_status === "reviewed";
  return {
    ...bank,
    is_manual: false,
    awaiting_post: false,
    notes: entry.notes ?? bank.notes ?? null,
    is_private: entry.is_private ?? false,
    private_until: entry.is_private ? (entry.private_until ?? null) : null,
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
