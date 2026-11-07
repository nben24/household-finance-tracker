// Shapes history for the Catch-up page. Pure, so it can be tested.

import type { TransactionRow } from "@/lib/db/types";
import { countsAsSpending } from "@/lib/finance/summary";
import { toCents } from "@/lib/money";
import { PRIVATE_LABEL } from "@/lib/finance/privacy";
import { kindOf, type ReviewKind } from "./review";

export interface MerchantGroup {
  merchant: string;
  /** what to show: the merchant, or a mask when every transaction in it is private */
  displayName: string;
  count: number;
  /** money out as a positive number, money in as negative */
  totalCents: number;
  from: string;
  to: string;
  example: string;
  kind: ReviewKind;
  /** the most common current suggestion, if any */
  subcategoryId: string | null;
  bankCategory: string | null;
}

function mostCommon<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function groupByMerchant(rows: TransactionRow[]): MerchantGroup[] {
  const groups = new Map<string, TransactionRow[]>();
  for (const row of rows) groups.set(row.normalized_merchant, [...(groups.get(row.normalized_merchant) ?? []), row]);
  return [...groups.entries()]
    .map(([merchant, items]) => {
      const dates = items.map((row) => row.transaction_date).sort();
      const allPrivate = items.every((row) => row.is_private);
      return {
        merchant,
        displayName: allPrivate ? PRIVATE_LABEL : merchant,
        count: items.length,
        totalCents: -items.reduce((total, row) => total + toCents(row.amount), 0),
        from: dates[0],
        to: dates[dates.length - 1],
        example: allPrivate ? "Only you can see these" : items[0].original_description,
        kind: mostCommon(items.map((row) => kindOf(row.transaction_type))) ?? "spending",
        subcategoryId: mostCommon(items.map((row) => row.subcategory_id).filter((id): id is string => id !== null)),
        bankCategory: mostCommon(items.map((row) => row.bank_category).filter((label): label is string => !!label)),
      };
    })
    .sort((a, b) => b.count - a.count || Math.abs(b.totalCents) - Math.abs(a.totalCents));
}

export type SortSource = "rules" | "bank" | "ai" | "you";

export const SORT_SOURCE_LABELS: Record<SortSource, string> = {
  rules: "Merchant and description rules",
  bank: "The bank's own category",
  ai: "AI suggestions",
  you: "Chosen by you",
};

/** How a categorized purchase got its category, from the reason recorded with it. */
export function sortSource(reason: string | null): SortSource | null {
  if (!reason) return null;
  if (reason.startsWith("AI suggestion")) return "ai";
  if (reason.startsWith("Chosen")) return "you";
  if (/bank's category/i.test(reason)) return "bank";
  if (/rule|Suggested by/i.test(reason)) return "rules";
  return null;
}

/** Counts categorized purchases by how they were sorted. */
export function sortSources(rows: Pick<TransactionRow, "transaction_type" | "category_id" | "categorization_reason">[]) {
  const counts: Record<SortSource, number> = { rules: 0, bank: 0, ai: 0, you: 0 };
  for (const row of rows) {
    if (!countsAsSpending(row) || !row.category_id) continue;
    const source = sortSource(row.categorization_reason);
    if (source) counts[source] += 1;
  }
  return counts;
}

/** A stable, spread-out sample: the same rows each time until the data changes. */
export function spotCheckSample<T extends { id: string }>(rows: T[], size: number): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id)).filter((_, index, all) => index % Math.max(1, Math.floor(all.length / size)) === 0).slice(0, size);
}
