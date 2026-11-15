// A month's closing snapshot, counted only from what both people can see.

import type { TransactionRow } from "@/lib/db/types";
import { isPrivateNow } from "./privacy";
import { viewEntries, viewTotals, type ViewOptions } from "./views";

export interface MonthSnapshot {
  spending_cents: number;
  income_cents: number;
  transaction_count: number;
}

/**
 * Totals for the household, leaving out private purchases that haven't been
 * revealed, so the snapshot is the same whichever of you closes the month and
 * can't hint at a hidden purchase.
 */
export function sharedSnapshot(rows: TransactionRow[], today: string, options: ViewOptions): MonthSnapshot {
  const shared = rows.filter((row) => !isPrivateNow(row, today));
  const totals = viewTotals(viewEntries(shared, { kind: "everyone" }, options), { kind: "everyone" });
  return { spending_cents: totals.spendingCents, income_cents: totals.incomeCents, transaction_count: shared.length };
}
