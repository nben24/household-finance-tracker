"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { applyRulesToWaiting } from "@/lib/categories/apply";
import { REVIEW_KINDS, reviewChanges, type ReviewKind } from "@/lib/categories/review";
import { findRule, learnFromChoice, normalizePattern } from "@/lib/categories/rules";
import { getDataSource, requireHousehold } from "@/lib/data";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import { isUuid } from "@/lib/params";

const DEMO_MESSAGE = "This is the demo with made-up data, so nothing can be saved here.";

export type ReviewResult = { ok: true; alsoSorted: number } | { ok: false; error: string };

function problem(error: unknown, action: string): { ok: false; error: string } {
  unstable_rethrow(error);
  console.error(`${action} failed`, error instanceof Error ? error.message : error);
  const needsUpdate = error instanceof Error && error.message === MISSING_MIGRATION;
  return { ok: false, error: needsUpdate ? MISSING_MIGRATION : "Something went wrong. Please try again." };
}

/**
 * Saves a decision about one transaction, and learns from it:
 * - "always" → this merchant is categorized automatically from now on, and
 *   other waiting transactions from it are sorted right away
 * - otherwise → the choice becomes the suggestion for next time
 */
export async function reviewTransaction(input: {
  id: string;
  kind: string;
  subcategoryId: string | null;
  always: boolean;
  notes?: string | null;
  /** also apply the same kind and category to every other transaction from this merchant */
  applyToMerchant?: boolean;
}): Promise<ReviewResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(input.id)) || !REVIEW_KINDS.includes(input.kind as ReviewKind)) {
      return { ok: false, error: "Something about that choice wasn't right. Please try again." };
    }
    const subcategoryId = input.subcategoryId && isUuid(input.subcategoryId) ? input.subcategoryId : null;

    const data = getDataSource();
    const householdId = session.household.id;
    const [transaction, categories, rules] = await Promise.all([
      data.getTransaction(householdId, input.id),
      data.listCategories(householdId),
      data.listRules(householdId),
    ]);
    if (!transaction) return { ok: false, error: "That transaction no longer exists." };

    const result = reviewChanges(transaction, input.kind as ReviewKind, subcategoryId, categories, session.members);
    if (!result.ok) return result;
    const changes = { ...result.changes };
    if (input.notes !== undefined) changes.notes = input.notes?.trim().slice(0, 500) || null;
    await data.updateTransactions(householdId, [transaction.id], changes);

    let alsoSorted = 0;
    // Private purchases never teach rules: rules are visible to both of you.
    if (
      changes.category_id &&
      changes.subcategory_id &&
      changes.transaction_type !== "reimbursement" &&
      !transaction.is_private
    ) {
      const merchant = normalizePattern(transaction.normalized_merchant);
      const merchantRules = rules.filter((rule) => rule.match_type === "merchant");
      const existing = findRule(merchantRules, transaction);
      const chosen = { category_id: changes.category_id, subcategory_id: changes.subcategory_id };
      const learned = learnFromChoice(existing, chosen, input.always);
      if (learned) {
        await data.saveRule(householdId, { match_type: "merchant", pattern: merchant, ...learned, source: "learned" });
      }
      // The bank's own label becomes a suggestion for merchants we haven't seen.
      if (transaction.bank_category) {
        await data.addMissingRules(householdId, [
          {
            match_type: "bank_category",
            pattern: normalizePattern(transaction.bank_category),
            ...chosen,
            auto_apply: false,
            source: "learned",
          },
        ]);
      }
      if (input.always) alsoSorted = await applyRulesToWaiting(data, householdId, session.household.review_starts_on);
    }

    if (input.applyToMerchant) {
      // Fix the merchant everywhere: the same decision for its other transactions.
      const others = (await data.listTransactions(householdId, { search: transaction.normalized_merchant })).rows.filter(
        (row) => row.id !== transaction.id && row.normalized_merchant === transaction.normalized_merchant && !row.is_private,
      );
      const groups = new Map<string, { changes: typeof changes; ids: string[] }>();
      for (const row of others) {
        const decided = reviewChanges(row, input.kind as ReviewKind, subcategoryId, categories, session.members);
        if (!decided.ok) continue; // e.g. a payback on a joint account
        const key = JSON.stringify(decided.changes);
        const group = groups.get(key) ?? { changes: decided.changes, ids: [] };
        group.ids.push(row.id);
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        alsoSorted += await data.updateTransactions(householdId, group.ids, group.changes);
      }
    }

    revalidatePath("/", "layout");
    return { ok: true, alsoSorted };
  } catch (error) {
    return problem(error, "reviewTransaction");
  }
}
