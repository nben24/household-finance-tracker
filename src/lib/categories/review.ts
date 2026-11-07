// What a review decision does to a transaction. Pure, so it can be tested.

import type { CategoryRow, TransactionRow, TransactionType } from "@/lib/db/types";
import type { TransactionChanges } from "@/lib/data/types";

/** The choices offered in Sunday Review, in plain language. */
export const REVIEW_KINDS = ["spending", "refund", "payback", "transfer", "income", "investment"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export const REVIEW_KIND_LABELS: Record<ReviewKind, string> = {
  spending: "Spending",
  refund: "Refund",
  payback: "Paying each other back",
  transfer: "Between our accounts",
  income: "Income",
  investment: "Investing",
};

export function kindOf(type: TransactionType): ReviewKind {
  switch (type) {
    case "refund":
      return "refund";
    case "reimbursement":
      return "payback";
    case "transfer":
    case "credit_card_payment":
      return "transfer";
    case "income":
      return "income";
    case "investment_contribution":
    case "investment_withdrawal":
      return "investment";
    default:
      return "spending";
  }
}

/** Kinds that need a category; a payback may optionally have one. */
export function needsCategory(kind: ReviewKind): boolean {
  return kind === "spending" || kind === "refund";
}

export function allowsCategory(kind: ReviewKind): boolean {
  return needsCategory(kind) || kind === "payback";
}

function typeFor(kind: ReviewKind, transaction: Pick<TransactionRow, "amount" | "transaction_type">): TransactionType {
  switch (kind) {
    case "spending":
      return "expense";
    case "refund":
      return "refund";
    case "payback":
      return "reimbursement";
    case "transfer":
      // keep the more specific label if the bank already said it was a card payment
      return transaction.transaction_type === "credit_card_payment" ? "credit_card_payment" : "transfer";
    case "income":
      return "income";
    case "investment":
      return transaction.amount < 0 ? "investment_contribution" : "investment_withdrawal";
  }
}

export type ReviewDecisionResult = { ok: true; changes: TransactionChanges } | { ok: false; error: string };

/**
 * Validates a review choice and turns it into the changes to save.
 * `members` decides who the other person in a payback is.
 */
export function reviewChanges(
  transaction: Pick<TransactionRow, "amount" | "transaction_type" | "person_id" | "counterparty_id">,
  kind: ReviewKind,
  subcategoryId: string | null,
  categories: Pick<CategoryRow, "id" | "parent_id" | "is_active" | "default_expense_type">[],
  members: { id: string }[],
): ReviewDecisionResult {
  let category: { categoryId: string; subcategoryId: string; expenseType: CategoryRow["default_expense_type"] } | null =
    null;
  if (subcategoryId && allowsCategory(kind)) {
    const subcategory = categories.find((c) => c.id === subcategoryId && c.parent_id !== null);
    if (!subcategory?.parent_id) return { ok: false, error: "That category doesn't exist." };
    category = {
      categoryId: subcategory.parent_id,
      subcategoryId: subcategory.id,
      expenseType: subcategory.default_expense_type,
    };
  }
  if (needsCategory(kind) && !category) return { ok: false, error: "Choose a category." };

  let counterpartyId: string | null = null;
  // Money into a joint account that's confirmed as between our accounts keeps
  // the record of who paid it in.
  if (kind === "transfer" && transaction.person_id === null && transaction.amount > 0) {
    counterpartyId = transaction.counterparty_id;
  }
  if (kind === "payback") {
    counterpartyId =
      transaction.counterparty_id ?? members.find((member) => member.id !== transaction.person_id)?.id ?? null;
    if (!transaction.person_id || !counterpartyId) {
      return {
        ok: false,
        error: "Paying each other back only works for an account that belongs to one of you, not a joint account.",
      };
    }
  }

  return {
    ok: true,
    changes: {
      transaction_type: typeFor(kind, transaction),
      counterparty_id: counterpartyId,
      category_id: category?.categoryId ?? null,
      subcategory_id: category?.subcategoryId ?? null,
      expense_type: category?.expenseType ?? null,
      review_status: "reviewed",
      categorization_confidence: "high",
      categorization_reason: "Chosen during review",
    },
  };
}
