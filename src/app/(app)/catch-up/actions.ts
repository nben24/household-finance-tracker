"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { SettingsResult } from "@/app/(app)/settings/actions";
import { isAiConfigured } from "@/lib/ai/categorize-merchants";
import { sortUnknownMerchantsWithAi } from "@/lib/categories/ai-sort";
import { applyRulesToWaiting } from "@/lib/categories/apply";
import { REVIEW_KINDS, reviewChanges, type ReviewKind } from "@/lib/categories/review";
import { findRule, learnFromChoice, normalizePattern } from "@/lib/categories/rules";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/config";
import { catchUpFilter, getDataSource, requireHousehold } from "@/lib/data";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import type { TransactionChanges } from "@/lib/data/types";
import { isISODate, todayInTimeZone } from "@/lib/dates";
import { isUuid } from "@/lib/params";

const DEMO_MESSAGE = "This is the demo with made-up data, so nothing can be saved here.";

function problem(error: unknown, action: string): { ok: false; error: string } {
  unstable_rethrow(error);
  console.error(`${action} failed`, error instanceof Error ? error.message : error);
  const needsUpdate = error instanceof Error && error.message === MISSING_MIGRATION;
  return { ok: false, error: needsUpdate ? MISSING_MIGRATION : "Something went wrong. Please try again." };
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Sets the date Sunday Review starts from; everything earlier is history. */
export async function setReviewStart(input: { date: string | null }): Promise<SettingsResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    const date = input.date ? String(input.date) : null;
    if (date && (!isISODate(date) || date > todayInTimeZone(HOUSEHOLD_TIME_ZONE))) {
      return { ok: false, error: "Choose a date that isn't in the future." };
    }
    const data = getDataSource();
    await data.updateHouseholdSettings(session.household.id, { review_starts_on: date });
    const accepted = await applyRulesToWaiting(data, session.household.id, date);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: date
        ? `Saved. ${plural(accepted, "older transaction")} sorted automatically from suggestions.`
        : "Saved. Everything now goes through Sunday Review.",
    };
  } catch (error) {
    return problem(error, "setReviewStart");
  }
}

export async function sortWithAi(): Promise<SettingsResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    if (!isAiConfigured()) return { ok: false, error: "AI sorting isn't set up yet (no API key)." };
    const data = getDataSource();
    const result = await sortUnknownMerchantsWithAi(data, session.household.id);
    const sorted = await applyRulesToWaiting(data, session.household.id, session.household.review_starts_on);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message:
        result.asked === 0
          ? "No unfamiliar merchants left to ask about."
          : `Asked about ${plural(result.asked, "merchant")} (${result.confident} answered confidently). ${plural(sorted, "transaction")} sorted.`,
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error("sortWithAi failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "The AI couldn't be reached. Check the API key and try again." };
  }
}

/** One decision for every waiting history transaction from a merchant. */
export async function decideMerchant(input: {
  merchant: string;
  kind: string;
  subcategoryId: string | null;
  always: boolean;
}): Promise<SettingsResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    if (!REVIEW_KINDS.includes(input.kind as ReviewKind)) return { ok: false, error: "Choose what these are." };
    const filter = catchUpFilter(session.household);
    if (!filter) return { ok: false, error: "Set a review start date first." };

    const data = getDataSource();
    const householdId = session.household.id;
    const [waiting, categories, rules] = await Promise.all([
      data.listTransactions(householdId, filter),
      data.listCategories(householdId),
      data.listRules(householdId),
    ]);
    const merchant = String(input.merchant ?? "");
    const rows = waiting.rows.filter((row) => row.normalized_merchant === merchant);
    if (rows.length === 0) return { ok: false, error: "These were already sorted." };
    const subcategoryId = input.subcategoryId && isUuid(input.subcategoryId) ? input.subcategoryId : null;

    const groups = new Map<string, { changes: TransactionChanges; ids: string[] }>();
    for (const row of rows) {
      const result = reviewChanges(row, input.kind as ReviewKind, subcategoryId, categories, session.members);
      if (!result.ok) return result;
      const changes = { ...result.changes, categorization_reason: "Chosen in Catch-up" };
      const key = JSON.stringify(changes);
      const group = groups.get(key) ?? { changes, ids: [] };
      group.ids.push(row.id);
      groups.set(key, group);
    }
    for (const group of groups.values()) await data.updateTransactions(householdId, group.ids, group.changes);

    const first = [...groups.values()][0].changes;
    // Private purchases never teach rules: rules are visible to both of you.
    if (
      first.category_id &&
      first.subcategory_id &&
      first.transaction_type !== "reimbursement" &&
      !rows.some((row) => row.is_private)
    ) {
      const existing = findRule(rules.filter((rule) => rule.match_type === "merchant"), rows[0]);
      const learned = learnFromChoice(
        existing,
        { category_id: first.category_id, subcategory_id: first.subcategory_id },
        input.always,
      );
      if (learned) {
        await data.saveRule(householdId, {
          match_type: "merchant",
          pattern: normalizePattern(merchant),
          ...learned,
          source: "learned",
        });
      }
    }
    revalidatePath("/", "layout");
    return { ok: true, message: `Sorted ${plural(rows.length, "transaction")} from ${merchant}.` };
  } catch (error) {
    return problem(error, "decideMerchant");
  }
}
