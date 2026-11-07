import type { TransactionRow } from "@/lib/db/types";

/** What the owner's own lists show instead of a private purchase's details. */
export const PRIVATE_LABEL = "Private purchase";

/** Still private (not yet past its reveal date). */
export function isPrivateNow(row: Pick<TransactionRow, "is_private" | "private_until">, today: string): boolean {
  return row.is_private && (row.private_until === null || row.private_until > today);
}

/** Only your own purchases and refunds can be kept private. */
export function canKeepPrivate(
  row: Pick<TransactionRow, "person_id" | "transaction_type">,
  userId: string,
): boolean {
  return row.person_id === userId && (row.transaction_type === "expense" || row.transaction_type === "refund");
}
