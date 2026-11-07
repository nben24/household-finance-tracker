import "server-only";
import type { DataSource, TransactionChanges } from "@/lib/data/types";
import type { TransactionRow } from "@/lib/db/types";
import { countsAsSpending } from "@/lib/finance/summary";
import { categorize } from "./rules";

const HISTORY_NOTE = " · accepted automatically for history";

/**
 * What the rules would change about one waiting transaction, or null.
 * Before `historyBefore`, suggestions are accepted rather than waiting for a
 * person; only transactions whose kind is genuinely unclear still wait.
 */
export function ruleChanges(
  transaction: TransactionRow,
  decision: ReturnType<typeof categorize>,
  historyBefore: string | null,
): TransactionChanges | null {
  const isHistory = historyBefore !== null && transaction.transaction_date < historyBefore;
  const typeIsUncertain = transaction.categorization_confidence === "low";

  if (!decision) {
    // History that isn't spending (transfers, paybacks…) and wasn't unclear: accept as is.
    if (isHistory && !typeIsUncertain && !countsAsSpending(transaction)) {
      return {
        review_status: "auto_categorized",
        categorization_reason: `${transaction.categorization_reason ?? "Recognized"}${HISTORY_NOTE}`,
      };
    }
    return null;
  }

  // A rule can pick the category, but when we weren't sure what kind of
  // transaction this is (e.g. a Zelle to someone else), a person still decides.
  if (typeIsUncertain) {
    if (decision.subcategory_id === transaction.subcategory_id) return null;
    return { ...decision, review_status: "needs_review", categorization_confidence: "low" };
  }
  if (isHistory && decision.review_status === "needs_review") {
    return {
      ...decision,
      review_status: "auto_categorized",
      categorization_reason: `${decision.categorization_reason}${HISTORY_NOTE}`,
    };
  }
  if (decision.subcategory_id === transaction.subcategory_id && decision.review_status === "needs_review") return null;
  return decision;
}

/**
 * Runs the household's rules over everything waiting for review and saves
 * the results. Returns how many transactions no longer need review.
 */
export async function applyRulesToWaiting(
  data: DataSource,
  householdId: string,
  historyBefore: string | null = null,
): Promise<number> {
  const [rules, categories, waiting] = await Promise.all([
    data.listRules(householdId),
    data.listCategories(householdId),
    data.listTransactions(householdId, { needsReview: true }),
  ]);

  // Group identical changes so each group is one database update.
  const groups = new Map<string, { changes: TransactionChanges; ids: string[] }>();
  let settled = 0;
  for (const transaction of waiting.rows) {
    const changes = ruleChanges(transaction, categorize(transaction, rules, categories), historyBefore);
    if (!changes) continue;
    if (changes.review_status !== "needs_review") settled += 1;
    const key = JSON.stringify(changes);
    const group = groups.get(key) ?? { changes, ids: [] };
    group.ids.push(transaction.id);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    await data.updateTransactions(householdId, group.ids, group.changes);
  }
  return settled;
}
