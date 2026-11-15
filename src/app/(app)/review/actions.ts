"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { applyRulesToWaitingDetailed } from "@/lib/categories/apply";
import { REVIEW_KINDS, REVIEW_KIND_LABELS, reviewChanges, type ReviewKind } from "@/lib/categories/review";
import { findRule, learnFromChoice, normalizePattern } from "@/lib/categories/rules";
import { getDataSource, requireHousehold } from "@/lib/data";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import { UndoError, type ReviewOperationInput, type ReviewSnapshot, type TransactionChanges } from "@/lib/data/types";
import type { CategorizationRuleRow, TransactionRow } from "@/lib/db/types";
import { isSplit } from "@/lib/finance/allocations";
import { isUuid } from "@/lib/params";

const DEMO_MESSAGE = "This is the demo with made-up data, so nothing can be saved here.";

export type ReviewResult =
  | {
      ok: true;
      alsoSorted: number;
      /** "Saved as Groceries. Sorted 4 more." */
      summary: string;
      /** present when the decision can be undone */
      operationId?: string;
    }
  | { ok: false; error: string };

export type UndoResult = { ok: true; message: string } | { ok: false; error: string };

function problem(error: unknown, action: string): { ok: false; error: string } {
  unstable_rethrow(error);
  console.error(`${action} failed`, error instanceof Error ? error.message : error);
  const needsUpdate = error instanceof Error && error.message === MISSING_MIGRATION;
  return { ok: false, error: needsUpdate ? MISSING_MIGRATION : "Something went wrong. Please try again." };
}

function snapshot(row: TransactionRow): ReviewSnapshot {
  return {
    transaction_type: row.transaction_type,
    counterparty_id: row.counterparty_id,
    category_id: row.category_id,
    subcategory_id: row.subcategory_id,
    expense_type: row.expense_type,
    review_status: row.review_status,
    categorization_confidence: row.categorization_confidence,
    categorization_reason: row.categorization_reason,
    notes: row.notes,
  };
}

/**
 * Saves a decision about one transaction, and learns from it:
 * - "always" → this merchant is categorized automatically from now on, and
 *   other waiting transactions from it are sorted right away
 * - otherwise → the choice becomes the suggestion for next time
 *
 * The whole decision (the transaction, any rule it created or changed, and
 * anything else it sorted) is recorded so it can be undone in one step.
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
    const changes: TransactionChanges = { ...result.changes };
    if (input.notes !== undefined) changes.notes = input.notes?.trim().slice(0, 500) || null;

    // What everything looked like before, for Undo.
    const before = new Map<string, { before: ReviewSnapshot; splits: TransactionRow["splits"] | null }>();
    before.set(transaction.id, { before: snapshot(transaction), splits: null });
    const ruleBefore: { rule: Pick<CategorizationRuleRow, "match_type" | "pattern">; before: CategorizationRuleRow | null }[] = [];

    // Choosing one category for a split purchase replaces its split.
    if (isSplit(transaction)) {
      before.set(transaction.id, { before: snapshot(transaction), splits: transaction.splits! });
      await data.saveSplits(householdId, transaction.id, []);
    }
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
        const current = rules.find((rule) => rule.match_type === "merchant" && rule.pattern === merchant) ?? null;
        ruleBefore.push({ rule: { match_type: "merchant", pattern: merchant }, before: current });
        await data.saveRule(householdId, { match_type: "merchant", pattern: merchant, ...learned, source: "learned" });
      }
      // The bank's own label becomes a suggestion for merchants we haven't seen.
      if (transaction.bank_category) {
        const pattern = normalizePattern(transaction.bank_category);
        if (!rules.some((rule) => rule.match_type === "bank_category" && rule.pattern === pattern)) {
          ruleBefore.push({ rule: { match_type: "bank_category", pattern }, before: null });
          await data.addMissingRules(householdId, [
            { match_type: "bank_category", pattern, ...chosen, auto_apply: false, source: "learned" },
          ]);
        }
      }
      if (input.always) {
        const sorted = await applyRulesToWaitingDetailed(data, householdId, session.household.review_starts_on, {
          except: [transaction.id],
        });
        alsoSorted += sorted.settled;
        for (const row of sorted.changed) if (!before.has(row.id)) before.set(row.id, { before: snapshot(row), splits: null });
      }
    }

    if (input.applyToMerchant) {
      // Fix the merchant everywhere: the same decision for its other
      // transactions (except private ones, and split purchases, whose parts
      // were chosen deliberately).
      const others = (await data.listTransactions(householdId, { search: transaction.normalized_merchant })).rows.filter(
        (row) =>
          row.id !== transaction.id &&
          row.normalized_merchant === transaction.normalized_merchant &&
          !row.is_private &&
          !isSplit(row),
      );
      const groups = new Map<string, { changes: TransactionChanges; ids: string[] }>();
      for (const row of others) {
        const decided = reviewChanges(row, input.kind as ReviewKind, subcategoryId, categories, session.members);
        if (!decided.ok) continue; // e.g. a payback on a joint account
        if (!before.has(row.id)) before.set(row.id, { before: snapshot(row), splits: null });
        const key = JSON.stringify(decided.changes);
        const group = groups.get(key) ?? { changes: decided.changes, ids: [] };
        group.ids.push(row.id);
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        alsoSorted += await data.updateTransactions(householdId, group.ids, group.changes);
      }
    }

    const choice = changes.subcategory_id
      ? (categories.find((category) => category.id === changes.subcategory_id)?.name ?? "")
      : REVIEW_KIND_LABELS[input.kind as ReviewKind];
    const summary = `Saved as ${choice}.${alsoSorted > 0 ? ` ${input.applyToMerchant ? "Changed" : "Sorted"} ${alsoSorted} more.` : ""}`;

    // Record the decision for Undo. If that fails, the decision itself still stands.
    let operationId: string | undefined;
    try {
      const after = await data.transactionsByIds(householdId, [...before.keys()]);
      const updatedRules = await data.listRules(householdId);
      const operation: ReviewOperationInput = {
        summary,
        transactions: after
          .filter((row) => before.has(row.id))
          .map((row) => ({ id: row.id, ...before.get(row.id)!, splits: before.get(row.id)!.splits ?? null, after: row.updated_at })),
        rules: ruleBefore.flatMap(({ rule, before: previous }) => {
          const now = updatedRules.find((r) => r.match_type === rule.match_type && r.pattern === rule.pattern);
          if (!now) return [];
          return [
            {
              ...rule,
              before: previous
                ? {
                    category_id: previous.category_id,
                    subcategory_id: previous.subcategory_id,
                    auto_apply: previous.auto_apply,
                    source: previous.source,
                  }
                : null,
              after: now.updated_at,
            },
          ];
        }),
      };
      operationId = await data.recordReviewOperation(householdId, operation);
    } catch (error) {
      console.error("Recording the decision for Undo failed", error instanceof Error ? error.message : error);
    }

    revalidatePath("/", "layout");
    return { ok: true, alsoSorted, summary, operationId };
  } catch (error) {
    return problem(error, "reviewTransaction");
  }
}

/** Undoes a whole review decision, if nothing it touched has changed since. */
export async function undoReview(input: { operationId: string }): Promise<UndoResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(input.operationId))) return { ok: false, error: "That decision can't be undone any more." };
    await getDataSource().undoReviewOperation(session.household.id, input.operationId);
    revalidatePath("/", "layout");
    return { ok: true, message: "Undone. Everything is back the way it was." };
  } catch (error) {
    if (error instanceof UndoError) {
      return {
        ok: false,
        error:
          error.reason === "conflict"
            ? "Undo isn't safe any more: some of these transactions or rules were changed since, so nothing was undone. You can still change them one by one."
            : "That decision can't be undone any more (it was already undone).",
      };
    }
    return problem(error, "undoReview");
  }
}
