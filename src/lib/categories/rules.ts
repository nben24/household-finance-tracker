// Rule-based categorization: deterministic, explainable, editable.

import type {
  CategorizationRuleRow,
  CategoryRow,
  ConfidenceLevel,
  ExpenseType,
  ReviewStatus,
  RuleMatchType,
  TransactionRow,
  TransactionType,
} from "@/lib/db/types";
import { countsAsSpending } from "@/lib/finance/summary";

export type RuleLike = Pick<
  CategorizationRuleRow,
  "match_type" | "pattern" | "category_id" | "subcategory_id" | "auto_apply"
> & { source?: CategorizationRuleRow["source"] };

type Categorizable = Pick<
  TransactionRow,
  "normalized_merchant" | "original_description" | "bank_category" | "transaction_type"
>;

export interface CategoryDecision {
  category_id: string | null;
  subcategory_id: string | null;
  expense_type: ExpenseType | null;
  review_status: ReviewStatus;
  categorization_confidence: ConfidenceLevel;
  categorization_reason: string;
}

export function normalizePattern(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word match, so "atm" matches "ATM WITHDRAWAL" but not "TREATMENT". */
function containsWords(haystack: string, needle: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}($|[^a-z0-9])`).test(haystack);
}

/**
 * The rule that applies, if any. Most specific first: an exact merchant rule,
 * then the longest matching description phrase, then the bank's category.
 */
export function findRule<R extends RuleLike>(rules: R[], transaction: Categorizable): R | null {
  const merchant = normalizePattern(transaction.normalized_merchant);
  const byMerchant = rules.find((rule) => rule.match_type === "merchant" && rule.pattern === merchant);
  if (byMerchant) return byMerchant;

  const description = normalizePattern(transaction.original_description);
  const byDescription = rules
    .filter((rule) => rule.match_type === "description" && containsWords(description, rule.pattern))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
  if (byDescription) return byDescription;

  if (transaction.bank_category) {
    const bankCategory = normalizePattern(transaction.bank_category);
    const byBank = rules.find((rule) => rule.match_type === "bank_category" && rule.pattern === bankCategory);
    if (byBank) return byBank;
  }
  return null;
}

const MATCH_LABELS: Record<RuleMatchType, string> = {
  merchant: "Merchant",
  description: "Description",
  bank_category: "Bank's category",
};

/**
 * Category for one transaction. Only spending (expenses and refunds) is
 * categorized; returns null for everything else or when no rule applies.
 */
export function categorize(
  transaction: Categorizable,
  rules: RuleLike[],
  categories: Pick<CategoryRow, "id" | "name" | "default_expense_type" | "is_active">[],
): CategoryDecision | null {
  if (!countsAsSpending(transaction)) return null;
  const rule = findRule(rules, transaction);
  if (!rule) return null;
  const subcategory = categories.find((category) => category.id === rule.subcategory_id);
  if (!subcategory?.is_active) return null;

  return {
    category_id: rule.category_id,
    subcategory_id: rule.subcategory_id,
    expense_type: subcategory.default_expense_type,
    review_status: rule.auto_apply ? "auto_categorized" : "needs_review",
    categorization_confidence: rule.auto_apply ? "high" : "medium",
    categorization_reason:
      rule.source === "ai"
        ? rule.auto_apply
          ? "AI suggestion"
          : "AI suggestion (unsure)"
        : rule.auto_apply
          ? `${MATCH_LABELS[rule.match_type]} rule`
          : `Suggested by ${MATCH_LABELS[rule.match_type].toLowerCase()} — purchases here vary`,
  };
}

/** Merchants that sell many kinds of things; never auto-apply by default. */
const VARIED_MERCHANTS = new Set(["amazon", "target", "walmart", "costco", "venmo", "paypal", "zelle", "apple"]);

/**
 * What a review choice teaches the app about this merchant.
 *
 * - "Always" checked → the merchant is categorized automatically from now on.
 * - Not checked → the choice becomes a suggestion for next time.
 * - Choosing differently from an automatic rule means the merchant varies,
 *   so the rule is downgraded to a suggestion rather than silently overridden.
 *
 * Returns null when nothing needs to change.
 */
export function learnFromChoice(
  existing: RuleLike | null,
  chosen: { category_id: string; subcategory_id: string },
  always: boolean,
): { category_id: string; subcategory_id: string; auto_apply: boolean } | null {
  if (always) {
    if (existing?.auto_apply && existing.subcategory_id === chosen.subcategory_id) return null;
    return { ...chosen, auto_apply: true };
  }
  if (existing && existing.subcategory_id === chosen.subcategory_id) return null;
  return { ...chosen, auto_apply: false };
}

/** Whether "Always use this category" should start checked for a merchant. */
export function alwaysByDefault(merchant: string, existing: RuleLike | null): boolean {
  if (existing && existing.match_type === "merchant" && !existing.auto_apply) return false;
  return !VARIED_MERCHANTS.has(normalizePattern(merchant));
}

/** Only these types get a category. */
export function isCategorizable(type: TransactionType): boolean {
  return countsAsSpending({ transaction_type: type });
}
