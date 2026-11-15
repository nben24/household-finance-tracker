"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { SettingsResult } from "@/app/(app)/settings/actions";
import { categorize } from "@/lib/categories/rules";
import { getDataSource, requireHousehold } from "@/lib/data";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import { SplitError } from "@/lib/data/types";
import { addDays, isISODate } from "@/lib/dates";
import type { ExpenseType, TransactionType } from "@/lib/db/types";
import { NEW_CASH_ACCOUNT, isCashAccount } from "@/lib/import/manual";
import { canKeepPrivate } from "@/lib/finance/privacy";
import { normalizeMerchant } from "@/lib/import/merchant";
import { isUuid } from "@/lib/params";
import { householdToday } from "@/lib/household-time";

const DEMO_MESSAGE = "This is the demo with made-up data, so nothing can be saved here.";
const KINDS: Record<string, TransactionType> = { spending: "expense", refund: "refund", income: "income" };

function problem(error: unknown, action: string): { ok: false; error: string } {
  unstable_rethrow(error);
  console.error(`${action} failed`, error instanceof Error ? error.message : error);
  const needsUpdate = error instanceof Error && error.message === MISSING_MIGRATION;
  return { ok: false, error: needsUpdate ? MISSING_MIGRATION : "Something went wrong. Please try again." };
}

export async function addManualTransaction(input: {
  date: string;
  amount: string | number;
  direction: "out" | "in";
  merchant: string;
  accountId: string;
  kind: string;
  subcategoryId: string | null;
  notes: string;
  expectPost: boolean;
  /** only the person who added it can see it */
  keepPrivate?: boolean;
}): Promise<SettingsResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    const today = householdToday(session.household);
    const date = String(input.date ?? "");
    if (!isISODate(date) || date > today || date < addDays(today, -366)) {
      return { ok: false, error: "Choose a date within the last year, not in the future." };
    }
    const value = Math.round(Number(input.amount) * 100) / 100;
    if (!Number.isFinite(value) || value <= 0 || value >= 1_000_000) return { ok: false, error: "Enter the amount." };
    const merchantText = String(input.merchant ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (!merchantText) return { ok: false, error: "Enter where you spent it." };
    const type = KINDS[input.kind];
    if (!type) return { ok: false, error: "Choose what kind of transaction this is." };
    const amount = input.direction === "in" ? value : -value;

    const data = getDataSource();
    const householdId = session.household.id;
    const [accounts, categories, rules] = await Promise.all([
      data.listAccounts(householdId),
      data.listCategories(householdId),
      data.listRules(householdId),
    ]);

    let account = accounts.find((candidate) => candidate.id === input.accountId);
    if (!account && input.accountId === NEW_CASH_ACCOUNT) {
      account =
        accounts.find((candidate) => isCashAccount(candidate) && candidate.owner_user_id === session.user.id) ??
        (await data.createAccount(householdId, {
          institution: "Cash",
          account_name: `${session.user.name || "My"} cash`,
          account_type: "other",
          owner_user_id: session.user.id,
          last_four: null,
        }));
    }
    if (!account) return { ok: false, error: "Choose which card or account it was on." };

    const keepPrivate = Boolean(input.keepPrivate);
    if (keepPrivate && (account.owner_user_id !== session.user.id || type === "income")) {
      return { ok: false, error: "Only your own purchases, on your own card or account, can be kept private." };
    }
    const normalized = normalizeMerchant(merchantText);
    let categoryFields: {
      category_id: string | null;
      subcategory_id: string | null;
      expense_type: ExpenseType | null;
      review_status: "auto_categorized" | "needs_review" | "reviewed";
      categorization_confidence: "high" | "medium" | "low";
      categorization_reason: string;
    } = {
      category_id: null,
      subcategory_id: null,
      expense_type: null,
      review_status: type === "income" ? "reviewed" : "needs_review",
      categorization_confidence: "high",
      categorization_reason: "Added by hand",
    };
    const subcategoryId = input.subcategoryId && isUuid(input.subcategoryId) ? input.subcategoryId : null;
    if (subcategoryId && type !== "income") {
      const subcategory = categories.find((c) => c.id === subcategoryId && c.parent_id !== null);
      if (!subcategory?.parent_id) return { ok: false, error: "That category doesn't exist." };
      categoryFields = {
        category_id: subcategory.parent_id,
        subcategory_id: subcategory.id,
        expense_type: subcategory.default_expense_type,
        review_status: "reviewed",
        categorization_confidence: "high",
        categorization_reason: "Chosen by you",
      };
    } else if (type !== "income") {
      const decision = categorize(
        { normalized_merchant: normalized, original_description: merchantText, bank_category: null, transaction_type: type },
        rules,
        categories,
      );
      if (decision) categoryFields = decision;
    }

    await data.insertTransactions([
      {
        household_id: householdId,
        account_id: account.id,
        person_id: account.owner_user_id,
        counterparty_id: null,
        transaction_date: date,
        posting_date: null,
        original_description: merchantText,
        normalized_merchant: normalized,
        amount,
        transaction_type: type,
        ...categoryFields,
        is_recurring: false,
        notes: String(input.notes ?? "").trim().slice(0, 500) || null,
        source_file: "Added by hand",
        source_hash: null,
        bank_category: null,
        is_manual: true,
        awaiting_post: Boolean(input.expectPost) && !isCashAccount(account),
        is_private: keepPrivate,
        private_until: null,
      },
    ]);
    revalidatePath("/", "layout");
    return { ok: true, message: `Added ${normalized}.` };
  } catch (error) {
    return problem(error, "addManualTransaction");
  }
}

async function manualEntry(id: string) {
  const session = await requireHousehold();
  if (session.isDemo || !isUuid(String(id))) return null;
  const data = getDataSource();
  const transaction = await data.getTransaction(session.household.id, id);
  return transaction?.is_manual ? { session, data, transaction } : null;
}

/** Only hand-added entries can be deleted; imported ones would just come back on the next import. */
export async function deleteManualTransaction(id: string): Promise<SettingsResult> {
  try {
    const entry = await manualEntry(id);
    if (!entry) return { ok: false, error: "Only transactions you added by hand can be deleted." };
    await entry.data.deleteTransaction(entry.session.household.id, id);
    revalidatePath("/", "layout");
    return { ok: true, message: "Deleted." };
  } catch (error) {
    return problem(error, "deleteManualTransaction");
  }
}

/** Keeps a hand-added entry for good: it won't be matched to an import any more. */
export async function stopWaitingToPost(id: string): Promise<SettingsResult> {
  try {
    const entry = await manualEntry(id);
    if (!entry) return { ok: false, error: "That entry no longer exists." };
    await entry.data.updateTransactions(entry.session.household.id, [id], { awaiting_post: false });
    revalidatePath("/", "layout");
    return { ok: true, message: "Kept. It won't be matched to a bank download." };
  } catch (error) {
    return problem(error, "stopWaitingToPost");
  }
}

/** Keep one of your own purchases private, optionally until a date, or make it visible again. */
export async function setPrivacy(input: { id: string; keepPrivate: boolean; until: string | null }): Promise<SettingsResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(input.id))) return { ok: false, error: "That transaction no longer exists." };
    const data = getDataSource();
    const transaction = await data.getTransaction(session.household.id, input.id);
    if (!transaction) return { ok: false, error: "That transaction no longer exists." };
    if (!canKeepPrivate(transaction, session.user.id)) {
      return { ok: false, error: "Only your own purchases can be kept private." };
    }
    const today = householdToday(session.household);
    const until = input.until ? String(input.until) : null;
    if (until && (!isISODate(until) || until <= today)) return { ok: false, error: "Choose a date after today." };
    await data.updateTransactions(session.household.id, [transaction.id], {
      is_private: Boolean(input.keepPrivate),
      private_until: input.keepPrivate ? until : null,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: input.keepPrivate ? "Only you can see this now." : "Visible to everyone again." };
  } catch (error) {
    return problem(error, "setPrivacy");
  }
}

// ---------------------------------------------------------------------------
// Split purchases and refunds
// ---------------------------------------------------------------------------

const SPLIT_ERRORS: Record<SplitError["reason"], string> = {
  not_found: "That transaction no longer exists.",
  kind: "Only purchases and refunds can be split.",
  count: "A split needs between 2 and 20 parts.",
  sign: "Enter each part as a positive amount.",
  total: "The parts need to add up to the transaction's amount exactly.",
};

function splitProblem(error: unknown, action: string): { ok: false; error: string } {
  if (error instanceof SplitError) return { ok: false, error: SPLIT_ERRORS[error.reason] };
  return problem(error, action);
}

/** "12.30" → 1230 cents, or null if it isn't a positive amount. */
function partCents(value: unknown): number | null {
  const text = String(value ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return cents > 0 && cents < 100_000_000 ? cents : null;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Divides a purchase (or refund) between categories. Amounts are entered as
 * positive numbers and must add up to the transaction's amount to the cent.
 * The bank's transaction itself is left as it was imported.
 */
export async function saveSplit(input: {
  id: string;
  parts: { subcategoryId: string; amount: string; note?: string }[];
}): Promise<SettingsResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(input.id)) || !Array.isArray(input.parts)) return { ok: false, error: SPLIT_ERRORS.not_found };
    const data = getDataSource();
    const householdId = session.household.id;
    const [transaction, categories] = await Promise.all([
      data.getTransaction(householdId, input.id),
      data.listCategories(householdId),
    ]);
    if (!transaction) return { ok: false, error: SPLIT_ERRORS.not_found };
    if (transaction.transaction_type !== "expense" && transaction.transaction_type !== "refund") {
      return { ok: false, error: SPLIT_ERRORS.kind };
    }
    if (input.parts.length < 2 || input.parts.length > 20) return { ok: false, error: SPLIT_ERRORS.count };

    const sign = Math.sign(transaction.amount) || -1;
    const parts = [];
    for (const [index, part] of input.parts.entries()) {
      const subcategory = categories.find((c) => c.id === part.subcategoryId && c.parent_id !== null);
      if (!subcategory?.parent_id) return { ok: false, error: `Choose a category for part ${index + 1}.` };
      const cents = partCents(part.amount);
      if (cents === null) return { ok: false, error: `Enter an amount for part ${index + 1}, like 12.50.` };
      parts.push({
        category_id: subcategory.parent_id,
        subcategory_id: subcategory.id,
        amount: (sign * cents) / 100,
        note: String(part.note ?? "").trim().slice(0, 200) || null,
      });
    }
    const totalCents = parts.reduce((sum, part) => sum + Math.round(Math.abs(part.amount) * 100), 0);
    const expected = Math.abs(Math.round(transaction.amount * 100));
    if (totalCents !== expected) {
      const difference = dollars(Math.abs(expected - totalCents));
      return {
        ok: false,
        error: `The parts add up to ${dollars(totalCents)}; they need to add up to ${dollars(expected)} (${difference} ${
          totalCents < expected ? "still to divide" : "too much"
        }).`,
      };
    }
    await data.saveSplits(householdId, transaction.id, parts);
    revalidatePath("/", "layout");
    return { ok: true, message: `Split between ${parts.length} categories.` };
  } catch (error) {
    return splitProblem(error, "saveSplit");
  }
}

/** Puts a split purchase back to a single category (its largest part's). */
export async function removeSplit(id: string): Promise<SettingsResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(id))) return { ok: false, error: SPLIT_ERRORS.not_found };
    await getDataSource().saveSplits(session.household.id, id, []);
    revalidatePath("/", "layout");
    return { ok: true, message: "No longer split. It counts under its main category." };
  } catch (error) {
    return splitProblem(error, "removeSplit");
  }
}

/**
 * Links a refund to the purchase it refunds. For a split purchase, `parts`
 * says which parts are being refunded and how much of each (positive amounts
 * adding up to the refund exactly); the refund is split the same way, so each
 * category gets its money back. Otherwise the refund takes the purchase's
 * category. A refund of a private purchase becomes private too (when it's
 * yours), so it can't give the purchase away.
 */
export async function linkRefund(input: {
  refundId: string;
  originalId: string | null;
  parts?: { splitId: string; amount: string }[];
}): Promise<SettingsResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(input.refundId))) return { ok: false, error: SPLIT_ERRORS.not_found };
    const data = getDataSource();
    const householdId = session.household.id;
    const refund = await data.getTransaction(householdId, input.refundId);
    if (!refund || refund.transaction_type !== "refund") {
      return { ok: false, error: "Only a refund can be linked to a purchase." };
    }

    if (input.originalId === null) {
      await data.updateTransactions(householdId, [refund.id], { refund_of: null });
      revalidatePath("/", "layout");
      return { ok: true, message: "Unlinked." };
    }
    if (!isUuid(String(input.originalId))) return { ok: false, error: "Choose the purchase it refunds." };
    const original = await data.getTransaction(householdId, input.originalId);
    if (!original || original.transaction_type !== "expense") return { ok: false, error: "Choose the purchase it refunds." };
    if (original.transaction_date > refund.transaction_date) {
      return { ok: false, error: "A refund can't come before its purchase." };
    }

    const privacy =
      original.is_private && canKeepPrivate(refund, session.user.id)
        ? { is_private: true, private_until: original.private_until }
        : {};
    const chosen = (input.parts ?? []).filter((part) => String(part.amount ?? "").trim() !== "");
    if (chosen.length > 0) {
      const originalParts = original.splits ?? [];
      const parts = [];
      for (const part of chosen) {
        const source = originalParts.find((candidate) => candidate.id === part.splitId);
        const cents = partCents(part.amount);
        if (!source || cents === null) return { ok: false, error: "Check the amounts being refunded." };
        if (cents > Math.round(Math.abs(source.amount) * 100)) {
          return { ok: false, error: "A part can't be refunded for more than it cost." };
        }
        parts.push({
          category_id: source.category_id,
          subcategory_id: source.subcategory_id,
          amount: cents / 100,
          refund_of_split_id: source.id,
        });
      }
      const totalCents = parts.reduce((sum, part) => sum + Math.round(part.amount * 100), 0);
      const refundCents = Math.round(refund.amount * 100);
      if (totalCents !== refundCents) {
        return { ok: false, error: `The refunded parts add up to ${dollars(totalCents)}; the refund is ${dollars(refundCents)}.` };
      }
      await data.updateTransactions(householdId, [refund.id], { refund_of: original.id, ...privacy });
      if (parts.length === 1) {
        await data.saveSplits(householdId, refund.id, []);
        await data.updateTransactions(householdId, [refund.id], {
          category_id: parts[0].category_id,
          subcategory_id: parts[0].subcategory_id,
          review_status: "reviewed",
          categorization_confidence: "high",
          categorization_reason: "Refund of part of a split purchase",
        });
      } else {
        await data.saveSplits(householdId, refund.id, parts);
      }
    } else {
      await data.updateTransactions(householdId, [refund.id], {
        refund_of: original.id,
        category_id: original.category_id,
        subcategory_id: original.subcategory_id,
        expense_type: original.expense_type,
        review_status: original.category_id ? "reviewed" : refund.review_status,
        categorization_confidence: "high",
        categorization_reason: "Refund of a linked purchase",
        ...privacy,
      });
    }
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Linked to ${original.normalized_merchant}.${"is_private" in privacy ? " Kept private, like the purchase." : ""}`,
    };
  } catch (error) {
    return splitProblem(error, "linkRefund");
  }
}
