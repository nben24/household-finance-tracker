import Link from "next/link";
import { OTHER_ALERT_DOLLARS } from "@/lib/config";
import type { CategoryRow, TransactionRow } from "@/lib/db/types";
import { otherSpending } from "@/lib/finance/summary";
import { formatCents } from "@/lib/money";
import { queryString } from "@/lib/params";

/** Points out when "Other" is growing, so it doesn't become a catch-all. */
export function OtherAlert({
  transactions,
  categories,
  month,
}: {
  transactions: TransactionRow[];
  categories: CategoryRow[];
  month: string;
}) {
  const other = otherSpending(transactions, categories);
  if (!other.categoryId || other.cents <= OTHER_ALERT_DOLLARS * 100) return null;
  return (
    <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      You have <span className="font-semibold tabular">{formatCents(other.cents)}</span> classified as Other this
      month across {other.count} {other.count === 1 ? "transaction" : "transactions"}.{" "}
      <Link
        href={`/transactions${queryString({ month, category: other.categoryId })}`}
        className="font-medium text-accent hover:underline"
      >
        Review them
      </Link>
    </p>
  );
}
