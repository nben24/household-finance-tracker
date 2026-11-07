import "server-only";
import {
  categorizeMerchants,
  isAiConfigured,
  type AskModel,
  type CategoryOption,
  type MerchantQuestion,
} from "@/lib/ai/categorize-merchants";
import type { DataSource } from "@/lib/data/types";
import type { CategoryRow, TransactionRow } from "@/lib/db/types";
import { countsAsSpending } from "@/lib/finance/summary";
import { normalizePattern } from "./rules";
import { findByPath } from "./setup";

/** Payment apps name people, not merchants; they are never sent to the AI. */
const PAYMENT_APP = /^(zelle|venmo|paypal|cash app|apple cash)\b/i;

export function categoryOptions(categories: CategoryRow[]): CategoryOption[] {
  const parents = new Map(categories.filter((c) => c.parent_id === null && c.is_active).map((c) => [c.id, c.name]));
  return categories
    .filter((c) => c.parent_id !== null && c.is_active && parents.has(c.parent_id))
    .map((c) => ({ label: `${parents.get(c.parent_id!)} › ${c.name}`, subcategoryId: c.id }));
}

/** Merchants that are waiting, uncategorized, and have no merchant rule yet. One question per merchant. */
export function merchantsToAsk(
  waiting: Pick<TransactionRow, "normalized_merchant" | "bank_category" | "category_id" | "transaction_type" | "is_private">[],
  merchantPatterns: Set<string>,
): MerchantQuestion[] {
  const questions = new Map<string, MerchantQuestion>();
  for (const row of waiting) {
    const key = normalizePattern(row.normalized_merchant);
    if (
      !countsAsSpending(row) ||
      row.is_private ||
      row.category_id !== null ||
      PAYMENT_APP.test(row.normalized_merchant) ||
      merchantPatterns.has(key) ||
      questions.has(key)
    ) {
      continue;
    }
    questions.set(key, { merchant: row.normalized_merchant, bankCategory: row.bank_category });
  }
  return [...questions.values()];
}

export interface AiSortResult {
  asked: number;
  confident: number;
}

/**
 * Asks the AI about unknown merchants and saves each answer as a rule:
 * confident answers sort automatically, unsure ones only suggest. Every
 * merchant is asked about once; its rule then answers for good.
 */
export async function sortUnknownMerchantsWithAi(
  data: DataSource,
  householdId: string,
  ask?: AskModel,
): Promise<AiSortResult> {
  if (!ask && !isAiConfigured()) return { asked: 0, confident: 0 };
  const [waiting, rules, categories] = await Promise.all([
    data.listTransactions(householdId, { needsReview: true }),
    data.listRules(householdId),
    data.listCategories(householdId),
  ]);
  const merchantPatterns = new Set(rules.filter((r) => r.match_type === "merchant").map((r) => r.pattern));
  const questions = merchantsToAsk(waiting.rows, merchantPatterns);
  if (questions.length === 0) return { asked: 0, confident: 0 };

  const answers = await categorizeMerchants(questions, categoryOptions(categories), ask);
  const fallback = findByPath(categories, "Other/Miscellaneous");
  const parentOf = new Map(categories.map((c) => [c.id, c.parent_id]));
  const newRules = answers.flatMap((answer) => {
    const subcategoryId = answer.subcategoryId ?? fallback?.subcategoryId;
    const categoryId = subcategoryId ? parentOf.get(subcategoryId) : null;
    if (!subcategoryId || !categoryId) return [];
    return [
      {
        match_type: "merchant" as const,
        pattern: normalizePattern(answer.merchant),
        category_id: categoryId,
        subcategory_id: subcategoryId,
        auto_apply: answer.confidence === "high",
        source: "ai" as const,
      },
    ];
  });
  await data.addMissingRules(householdId, newRules);
  return { asked: questions.length, confident: newRules.filter((rule) => rule.auto_apply).length };
}
