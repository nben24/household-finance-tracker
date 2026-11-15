// How a transaction's amount divides between categories: one part normally,
// or the parts of a split purchase. Every total that groups spending by
// category goes through here, so a split purchase is counted exactly once,
// as its parts, everywhere (dashboard, budgets, reports, forecasts, charts,
// exports).

import type { SplitRow, TransactionRow } from "@/lib/db/types";
import { toCents } from "@/lib/money";

export interface Allocation {
  /** signed, like the transaction (negative = money out) */
  cents: number;
  categoryId: string | null;
  subcategoryId: string | null;
  splitId?: string;
}

type Row = Pick<TransactionRow, "amount" | "category_id" | "subcategory_id"> & { splits?: Pick<SplitRow, "id" | "amount" | "category_id" | "subcategory_id">[] };

/** A split counts only when its parts add up to the transaction exactly; otherwise the transaction counts whole. */
export function isSplit(row: Row): boolean {
  const parts = row.splits ?? [];
  if (parts.length < 2) return false;
  return parts.reduce((total, part) => total + toCents(part.amount), 0) === toCents(row.amount);
}

export function allocationsOf(row: Row): Allocation[] {
  if (!isSplit(row)) {
    return [{ cents: toCents(row.amount), categoryId: row.category_id, subcategoryId: row.subcategory_id }];
  }
  return row.splits!.map((part) => ({
    cents: toCents(part.amount),
    categoryId: part.category_id,
    subcategoryId: part.subcategory_id,
    splitId: part.id,
  }));
}
