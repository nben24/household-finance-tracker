"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { SettingsResult } from "@/app/(app)/settings/actions";
import { categorize } from "@/lib/categories/rules";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/config";
import { getDataSource, requireHousehold } from "@/lib/data";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import { addDays, isISODate, todayInTimeZone } from "@/lib/dates";
import type { ExpenseType, TransactionType } from "@/lib/db/types";
import { NEW_CASH_ACCOUNT, isCashAccount } from "@/lib/import/manual";
import { canKeepPrivate } from "@/lib/finance/privacy";
import { normalizeMerchant } from "@/lib/import/merchant";
import { isUuid } from "@/lib/params";

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
    const today = todayInTimeZone(HOUSEHOLD_TIME_ZONE);
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
    const today = todayInTimeZone(HOUSEHOLD_TIME_ZONE);
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
