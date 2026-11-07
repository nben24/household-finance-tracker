// Shapes database rows for the review and edit screens.

import type { CategoryGroup, ReviewItem } from "@/components/review/review-card";
import type { Member } from "@/lib/data/types";
import type { AccountRow, CategorizationRuleRow, CategoryRow, TransactionRow } from "@/lib/db/types";
import { PRIVATE_LABEL, isPrivateNow } from "@/lib/finance/privacy";
import { kindOf } from "./review";
import { alwaysByDefault, findRule } from "./rules";

/** Active categories for pickers, keeping a hidden one if it's currently selected. */
export function categoryGroups(categories: CategoryRow[], keepIds: (string | null)[] = []): CategoryGroup[] {
  const visible = (category: CategoryRow) => category.is_active || keepIds.includes(category.id);
  return categories
    .filter((category) => category.parent_id === null && visible(category))
    .map((parent) => ({
      id: parent.id,
      name: parent.name,
      children: categories
        .filter((child) => child.parent_id === parent.id && visible(child))
        .map((child) => ({ id: child.id, name: child.name })),
    }))
    .filter((group) => group.children.length > 0);
}

/** The subcategories used most often in the given transactions. */
export function frequentSubcategories(transactions: Pick<TransactionRow, "subcategory_id">[], limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.subcategory_id) {
      counts.set(transaction.subcategory_id, (counts.get(transaction.subcategory_id) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

export function toReviewItem(
  transaction: TransactionRow,
  accounts: Map<string, AccountRow>,
  members: Map<string, Member>,
  rules: CategorizationRuleRow[],
  /** pass today to mask private purchases (lists and queues); omit on the transaction's own page */
  maskPrivateOn?: string,
): ReviewItem {
  const masked = maskPrivateOn !== undefined && isPrivateNow(transaction, maskPrivateOn);
  const account = accounts.get(transaction.account_id);
  const merchantRule = findRule(
    rules.filter((rule) => rule.match_type === "merchant"),
    transaction,
  );
  return {
    id: transaction.id,
    date: transaction.transaction_date,
    merchant: masked ? PRIVATE_LABEL : transaction.normalized_merchant,
    description: masked ? "Only you can see this · open it for details" : transaction.original_description,
    amount: transaction.amount,
    personName: transaction.person_id ? (members.get(transaction.person_id)?.name ?? "") : "Shared",
    accountLabel: account ? `${account.institution} ${account.account_name}` : "",
    kind: kindOf(transaction.transaction_type),
    subcategoryId: transaction.subcategory_id,
    reason: transaction.categorization_reason,
    // Private purchases never teach rules, so there's no "always" choice for them.
    alwaysDefault: !transaction.is_private && alwaysByDefault(transaction.normalized_merchant, merchantRule),
    isPrivate: transaction.is_private,
    paybackAllowed: transaction.person_id !== null && members.size > 1,
    notes: transaction.notes,
  };
}
