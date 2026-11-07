"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { applyRulesToWaiting } from "@/lib/categories/apply";
import { recheckTransactions } from "@/lib/categories/maintenance";
import { normalizePattern } from "@/lib/categories/rules";
import { defaultRuleRows, missingDefaultCategories } from "@/lib/categories/setup";
import { getDataSource, requireHousehold } from "@/lib/data";
import { DUPLICATE_CATEGORY, MISSING_MIGRATION } from "@/lib/data/supabase";
import type { ExpenseType, RuleMatchType } from "@/lib/db/types";
import { isUuid } from "@/lib/params";

export type SettingsResult = { ok: true; message?: string } | { ok: false; error: string };

const DEMO_MESSAGE = "This is the demo with made-up data, so nothing can be saved here.";
const MATCH_TYPES: RuleMatchType[] = ["merchant", "description", "bank_category"];
const EXPENSE_TYPES: ExpenseType[] = ["fixed", "variable", "discretionary", "irregular"];

function problem(error: unknown, action: string): { ok: false; error: string } {
  unstable_rethrow(error);
  console.error(`${action} failed`, error instanceof Error ? error.message : error);
  if (error instanceof Error && [MISSING_MIGRATION, DUPLICATE_CATEGORY].includes(error.message)) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "Something went wrong. Please try again." };
}

async function editableHousehold() {
  const session = await requireHousehold();
  return session.isDemo ? null : session;
}

function sortedMessage(count: number): string {
  if (count === 0) return "Saved.";
  return `Saved. ${count} waiting ${count === 1 ? "transaction was" : "transactions were"} sorted automatically.`;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export async function addRule(input: {
  matchType: string;
  pattern: string;
  subcategoryId: string;
  autoApply: boolean;
}): Promise<SettingsResult> {
  try {
    const session = await editableHousehold();
    if (!session) return { ok: false, error: DEMO_MESSAGE };
    const pattern = normalizePattern(String(input.pattern ?? "")).slice(0, 100);
    if (!MATCH_TYPES.includes(input.matchType as RuleMatchType)) return { ok: false, error: "Choose what to match." };
    if (!pattern) return { ok: false, error: "Enter the text to match." };

    const data = getDataSource();
    const householdId = session.household.id;
    const categories = await data.listCategories(householdId);
    const subcategory = categories.find((c) => c.id === input.subcategoryId && c.parent_id !== null);
    if (!subcategory?.parent_id) return { ok: false, error: "Choose a category." };

    await data.saveRule(householdId, {
      match_type: input.matchType as RuleMatchType,
      pattern,
      category_id: subcategory.parent_id,
      subcategory_id: subcategory.id,
      auto_apply: Boolean(input.autoApply),
      source: "manual",
    });
    const sorted = await applyRulesToWaiting(data, householdId, session.household.review_starts_on);
    revalidatePath("/", "layout");
    return { ok: true, message: sortedMessage(sorted) };
  } catch (error) {
    return problem(error, "addRule");
  }
}

export async function updateRule(input: {
  id: string;
  subcategoryId?: string;
  autoApply?: boolean;
}): Promise<SettingsResult> {
  try {
    const session = await editableHousehold();
    if (!session) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(input.id))) return { ok: false, error: "That rule no longer exists." };

    const data = getDataSource();
    const householdId = session.household.id;
    const changes: { category_id?: string; subcategory_id?: string; auto_apply?: boolean } = {};
    if (input.subcategoryId !== undefined) {
      const categories = await data.listCategories(householdId);
      const subcategory = categories.find((c) => c.id === input.subcategoryId && c.parent_id !== null);
      if (!subcategory?.parent_id) return { ok: false, error: "Choose a category." };
      changes.category_id = subcategory.parent_id;
      changes.subcategory_id = subcategory.id;
    }
    if (input.autoApply !== undefined) changes.auto_apply = Boolean(input.autoApply);

    await data.updateRule(householdId, input.id, changes);
    const sorted = await applyRulesToWaiting(data, householdId, session.household.review_starts_on);
    revalidatePath("/", "layout");
    return { ok: true, message: sortedMessage(sorted) };
  } catch (error) {
    return problem(error, "updateRule");
  }
}

export async function deleteRule(id: string): Promise<SettingsResult> {
  try {
    const session = await editableHousehold();
    if (!session) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(id))) return { ok: false, error: "That rule no longer exists." };
    await getDataSource().deleteRule(session.household.id, id);
    revalidatePath("/", "layout");
    return { ok: true, message: "Rule removed. Transactions already sorted by it keep their category." };
  } catch (error) {
    return problem(error, "deleteRule");
  }
}

export async function applyRules(): Promise<SettingsResult> {
  try {
    const session = await editableHousehold();
    if (!session) return { ok: false, error: DEMO_MESSAGE };
    const sorted = await applyRulesToWaiting(getDataSource(), session.household.id, session.household.review_starts_on);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message:
        sorted === 0
          ? "No waiting transactions matched a rule."
          : `${sorted} waiting ${sorted === 1 ? "transaction was" : "transactions were"} sorted.`,
    };
  } catch (error) {
    return problem(error, "applyRules");
  }
}

export async function recheckExisting(): Promise<SettingsResult> {
  try {
    const session = await editableHousehold();
    if (!session) return { ok: false, error: DEMO_MESSAGE };
    const result = await recheckTransactions(getDataSource(), session.household, session.members);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Done. ${result.renamed} merchant names updated, ${result.retyped} investments or transfers no longer counted as spending, ${result.contributors} shared-account deposits linked to a person, ${result.paired} transfers between your accounts matched, ${result.sorted} waiting transactions sorted.`,
    };
  } catch (error) {
    return problem(error, "recheckExisting");
  }
}

/** Adds any built-in categories and rules this household doesn't have yet. Never overwrites. */
export async function addDefaults(): Promise<SettingsResult> {
  try {
    const session = await editableHousehold();
    if (!session) return { ok: false, error: DEMO_MESSAGE };
    const data = getDataSource();
    const householdId = session.household.id;

    let categories = await data.listCategories(householdId);
    const missing = missingDefaultCategories(categories);
    for (const item of missing) {
      let parent = categories.find((c) => c.parent_id === null && c.name.toLowerCase() === item.parentName.toLowerCase());
      if (!parent) {
        parent = await data.createCategory(householdId, {
          parent_id: null,
          name: item.parentName,
          default_expense_type: null,
          sort_order: categories.filter((c) => c.parent_id === null).length,
        });
        categories = [...categories, parent];
      }
      const child = await data.createCategory(householdId, {
        parent_id: parent.id,
        name: item.name,
        default_expense_type: item.expenseType,
        sort_order: item.sortOrder,
      });
      categories = [...categories, child];
    }

    const before = (await data.listRules(householdId)).length;
    await data.addMissingRules(householdId, defaultRuleRows(categories));
    const added = (await data.listRules(householdId)).length - before;
    const sorted = await applyRulesToWaiting(data, householdId, session.household.review_starts_on);

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Added ${missing.length} ${missing.length === 1 ? "category" : "categories"} and ${added} ${
        added === 1 ? "rule" : "rules"
      }. ${sorted} waiting ${sorted === 1 ? "transaction was" : "transactions were"} sorted.`,
    };
  } catch (error) {
    return problem(error, "addDefaults");
  }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function addCategory(input: {
  parentId: string | null;
  name: string;
  expenseType: string;
}): Promise<SettingsResult> {
  try {
    const session = await editableHousehold();
    if (!session) return { ok: false, error: DEMO_MESSAGE };
    const name = String(input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return { ok: false, error: "Enter a name." };
    if (!input.parentId && name.includes("/")) {
      return { ok: false, error: "Top-level category names can't contain “/”." };
    }

    const data = getDataSource();
    const householdId = session.household.id;
    const categories = await data.listCategories(householdId);
    let parentId: string | null = null;
    if (input.parentId) {
      const parent = categories.find((c) => c.id === input.parentId && c.parent_id === null);
      if (!parent) return { ok: false, error: "That category no longer exists." };
      parentId = parent.id;
    }
    const expenseType = EXPENSE_TYPES.includes(input.expenseType as ExpenseType)
      ? (input.expenseType as ExpenseType)
      : null;

    await data.createCategory(householdId, {
      parent_id: parentId,
      name,
      default_expense_type: parentId ? expenseType : null,
      sort_order: categories.filter((c) => c.parent_id === parentId).length,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return problem(error, "addCategory");
  }
}

export async function updateCategory(input: {
  id: string;
  name?: string;
  isActive?: boolean;
}): Promise<SettingsResult> {
  try {
    const session = await editableHousehold();
    if (!session) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(input.id))) return { ok: false, error: "That category no longer exists." };
    const changes: { name?: string; is_active?: boolean } = {};
    if (input.name !== undefined) {
      const name = String(input.name).trim().replace(/\s+/g, " ").slice(0, 40);
      if (!name) return { ok: false, error: "Enter a name." };
      changes.name = name;
    }
    if (input.isActive !== undefined) changes.is_active = Boolean(input.isActive);
    if (changes.name?.includes("/")) {
      const categories = await getDataSource().listCategories(session.household.id);
      if (categories.some((c) => c.id === input.id && c.parent_id === null)) {
        return { ok: false, error: "Top-level category names can't contain “/”." };
      }
    }
    await getDataSource().updateCategory(session.household.id, input.id, changes);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return problem(error, "updateCategory");
  }
}
