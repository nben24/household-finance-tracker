"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { SettingsResult } from "@/app/(app)/settings/actions";
import { SHARED_SPENDING_MODE } from "@/lib/config";
import { getDataSource, requireHousehold, type HouseholdContext } from "@/lib/data";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import { BudgetError } from "@/lib/data/types";
import { formatMonth, isMonthKey } from "@/lib/dates";
import { BUDGET_KINDS, type BudgetKind, type BudgetLineRow, type CategoryRow } from "@/lib/db/types";
import { activeIn, findConflict, scopeOf, suggestedKind, tidyAmount, viewOfLine } from "@/lib/finance/budgets";
import { loadBudget } from "@/lib/finance/load-budget";
import { parseView, viewLabel, viewParam } from "@/lib/finance/view-param";
import { formatCentsRounded } from "@/lib/money";
import { isUuid, queryString } from "@/lib/params";

const DEMO_MESSAGE = "This is the demo with made-up data, so nothing can be saved here.";
const STALE = "This budget was changed by someone else since the page loaded. Here's the latest — please try again.";

function problem(error: unknown, action: string): { ok: false; error: string } {
  unstable_rethrow(error);
  if (error instanceof BudgetError) {
    if (error.reason === "stale" || error.reason === "not_found") return { ok: false, error: STALE };
    return { ok: false, error: "That category already has a budget here, or is budgeted for the whole household." };
  }
  console.error(`${action} failed`, error instanceof Error ? error.message : error);
  const needsUpdate = error instanceof Error && error.message === MISSING_MIGRATION;
  return { ok: false, error: needsUpdate ? MISSING_MIGRATION : "Something went wrong. Please try again." };
}

function parseAmount(value: unknown): number | null {
  const text = String(value ?? "").replace(/[$,\s]/g, "");
  if (text === "") return null;
  const amount = Math.round(Number(text) * 100) / 100;
  return Number.isFinite(amount) && amount >= 0 && amount < 10_000_000 ? amount : null;
}

async function context(monthValue: unknown) {
  const session = await requireHousehold();
  const month = String(monthValue ?? "");
  if (session.isDemo || !isMonthKey(month)) return null;
  return { session, month, data: getDataSource(), householdId: session.household.id };
}

function lineName(line: Pick<BudgetLineRow, "category_id" | "subcategory_id">, categories: CategoryRow[]): string {
  const name = (id: string | null) => categories.find((category) => category.id === id)?.name ?? "";
  return line.subcategory_id ? `${name(line.category_id)} › ${name(line.subcategory_id)}` : name(line.category_id);
}

/** "Groceries already has a budget under Everyone ($900 a month)." with a link to it. */
function conflictResult(
  existing: BudgetLineRow,
  categories: CategoryRow[],
  session: HouseholdContext,
  month: string,
): SettingsResult {
  const where = viewOfLine(existing);
  const label = viewLabel(where, session.members);
  const whereText = where.kind === "everyone" ? "for the whole household (Everyone)" : `under ${label}`;
  const value = viewParam(where);
  return {
    ok: false,
    error: `${lineName(existing, categories)} already has a budget ${whereText}: ${formatCentsRounded(
      Math.round(existing.amount * 100),
    )} a month. Budgeting it here too would count the same spending twice — change that one instead.`,
    link: {
      href: `/budget${queryString({ month, view: value === "everyone" ? undefined : value })}`,
      label: `Open ${label}'s budget`,
    },
  };
}

export async function addBudgetLine(input: {
  view: string;
  month: string;
  categoryId: string;
  subcategoryId: string | null;
  kind: string;
  amount: number | string;
}): Promise<SettingsResult> {
  try {
    const ctx = await context(input.month);
    if (!ctx) return { ok: false, error: DEMO_MESSAGE };
    const amount = parseAmount(input.amount);
    if (amount === null) return { ok: false, error: "Enter an amount." };
    if (!BUDGET_KINDS.includes(input.kind as BudgetKind)) return { ok: false, error: "Choose a kind of budget." };

    const categories = await ctx.data.listCategories(ctx.householdId);
    const category = categories.find((c) => c.id === input.categoryId && c.parent_id === null);
    if (!category) return { ok: false, error: "Choose a category." };
    const subcategoryId = input.subcategoryId && isUuid(input.subcategoryId) ? input.subcategoryId : null;
    if (subcategoryId && !categories.some((c) => c.id === subcategoryId && c.parent_id === category.id)) {
      return { ok: false, error: "Choose a category." };
    }

    const view = parseView(input.view, ctx.session.members);
    const candidate = { ...scopeOf(view), category_id: category.id, subcategory_id: subcategoryId };
    const lines = await ctx.data.listBudgetLines(ctx.householdId);
    const fromMonth = `${ctx.month}-01`;
    const stillActive = lines.filter((line) => line.ends_month === null || line.ends_month >= fromMonth);
    const existing = findConflict(candidate, stillActive, SHARED_SPENDING_MODE);
    if (existing) return conflictResult(existing, categories, ctx.session, ctx.month);

    // The database re-checks for a conflict under a lock, in case someone else just added one.
    await ctx.data.createBudgetLine(ctx.householdId, {
      ...candidate,
      kind: input.kind as BudgetKind,
      amount,
      starts_month: fromMonth,
      ends_month: null,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Added from ${formatMonth(ctx.month)} on.` };
  } catch (error) {
    return problem(error, "addBudgetLine");
  }
}

/**
 * Changes take effect from the month being viewed. Months before it keep the
 * budget they had: the old line ends the month before and a new one begins,
 * in one database transaction.
 */
export async function changeBudgetLine(input: {
  id: string;
  month: string;
  amount: number | string;
  kind: string;
}): Promise<SettingsResult> {
  try {
    const ctx = await context(input.month);
    if (!ctx) return { ok: false, error: DEMO_MESSAGE };
    const amount = parseAmount(input.amount);
    if (amount === null) return { ok: false, error: "Enter an amount." };
    if (!BUDGET_KINDS.includes(input.kind as BudgetKind)) return { ok: false, error: "Choose a kind of budget." };
    if (!isUuid(String(input.id))) return { ok: false, error: STALE };

    const lines = await ctx.data.listBudgetLines(ctx.householdId);
    if (!activeIn(lines, ctx.month).some((candidate) => candidate.id === input.id)) {
      revalidatePath("/", "layout");
      return { ok: false, error: STALE };
    }
    await ctx.data.changeBudgetLine(ctx.householdId, input.id, ctx.month, { amount, kind: input.kind as BudgetKind });
    revalidatePath("/", "layout");
    return { ok: true, message: `Saved from ${formatMonth(ctx.month)} on. Earlier months keep their budget.` };
  } catch (error) {
    revalidatePath("/", "layout");
    return problem(error, "changeBudgetLine");
  }
}

export async function removeBudgetLine(input: { id: string; month: string }): Promise<SettingsResult> {
  try {
    const ctx = await context(input.month);
    if (!ctx) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(input.id))) return { ok: false, error: STALE };
    const lines = await ctx.data.listBudgetLines(ctx.householdId);
    if (!activeIn(lines, ctx.month).some((candidate) => candidate.id === input.id)) {
      revalidatePath("/", "layout");
      return { ok: false, error: STALE };
    }
    await ctx.data.endBudgetLine(ctx.householdId, input.id, ctx.month);
    revalidatePath("/", "layout");
    return { ok: true, message: "Removed from this month on. Earlier months keep it." };
  } catch (error) {
    revalidatePath("/", "layout");
    return problem(error, "removeBudgetLine");
  }
}

export interface BudgetSuggestion {
  categoryId: string;
  name: string;
  kind: BudgetKind;
  /** the recent monthly average, exact */
  averageCents: number;
  /** the average rounded up to a tidy amount, in dollars */
  amount: number;
}

export type SuggestionsResult =
  | { ok: true; suggestions: BudgetSuggestion[]; months: number; partialMonths: string[] }
  | { ok: false; error: string };

/**
 * Suggested budgets for categories with recent spending and no budget yet,
 * from complete recent months. Nothing is saved: the person reviews and
 * edits them, then confirms with addSuggestedBudgets.
 */
export async function previewSuggestedBudgets(input: { view: string; month: string }): Promise<SuggestionsResult> {
  try {
    const ctx = await context(input.month);
    if (!ctx) return { ok: false, error: DEMO_MESSAGE };
    const view = parseView(input.view, ctx.session.members);
    const budget = await loadBudget(ctx.session, view, ctx.month);
    if (budget.averageMonths === 0) {
      return {
        ok: false,
        error:
          budget.partialMonths.length > 0
            ? "None of the last three months has every account's activity imported, so there's nothing reliable to suggest from yet."
            : "There isn't a complete month of history yet to suggest from.",
      };
    }
    const scope = scopeOf(view);
    const fromMonth = `${ctx.month}-01`;
    const stillActive = budget.allLines.filter((line) => line.ends_month === null || line.ends_month >= fromMonth);
    const suggestions: BudgetSuggestion[] = [];
    for (const category of budget.categories.filter((c) => c.parent_id === null && c.is_active)) {
      const averageCents = budget.averages[category.id] ?? 0;
      const amount = tidyAmount(averageCents);
      const candidate = { ...scope, category_id: category.id, subcategory_id: null };
      if (amount === 0 || findConflict(candidate, stillActive, SHARED_SPENDING_MODE)) continue;
      suggestions.push({
        categoryId: category.id,
        name: category.name,
        kind: suggestedKind(category.id, null, budget.categories),
        averageCents,
        amount,
      });
    }
    return { ok: true, suggestions, months: budget.averageMonths, partialMonths: budget.partialMonths };
  } catch (error) {
    return problem(error, "previewSuggestedBudgets");
  }
}

/** Adds the budgets the person confirmed (amounts and kinds as they left them). */
export async function addSuggestedBudgets(input: {
  view: string;
  month: string;
  items: { categoryId: string; kind: string; amount: string | number }[];
}): Promise<SettingsResult> {
  try {
    const ctx = await context(input.month);
    if (!ctx) return { ok: false, error: DEMO_MESSAGE };
    if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 100) {
      return { ok: false, error: "Choose at least one budget to add." };
    }
    const view = parseView(input.view, ctx.session.members);
    const scope = scopeOf(view);
    const [categories, lines] = await Promise.all([
      ctx.data.listCategories(ctx.householdId),
      ctx.data.listBudgetLines(ctx.householdId),
    ]);
    const fromMonth = `${ctx.month}-01`;
    const stillActive = lines.filter((line) => line.ends_month === null || line.ends_month >= fromMonth);

    const valid: { categoryId: string; kind: BudgetKind; amount: number }[] = [];
    for (const item of input.items) {
      const category = categories.find((c) => c.id === item.categoryId && c.parent_id === null);
      const amount = parseAmount(item.amount);
      if (!category || amount === null || !BUDGET_KINDS.includes(item.kind as BudgetKind)) {
        return { ok: false, error: `Check the amount for ${category?.name ?? "each budget"}.` };
      }
      valid.push({ categoryId: category.id, kind: item.kind as BudgetKind, amount });
    }

    let added = 0;
    const skipped: string[] = [];
    for (const item of valid) {
      const candidate = { ...scope, category_id: item.categoryId, subcategory_id: null };
      if (findConflict(candidate, stillActive, SHARED_SPENDING_MODE)) {
        skipped.push(categories.find((c) => c.id === item.categoryId)?.name ?? "");
        continue;
      }
      try {
        await ctx.data.createBudgetLine(ctx.householdId, {
          ...candidate,
          kind: item.kind,
          amount: item.amount,
          starts_month: fromMonth,
          ends_month: null,
        });
        added += 1;
      } catch (error) {
        if (error instanceof BudgetError && error.reason === "conflict") {
          skipped.push(categories.find((c) => c.id === item.categoryId)?.name ?? "");
          continue;
        }
        throw error;
      }
    }
    revalidatePath("/", "layout");
    const addedText = `Added ${added} ${added === 1 ? "budget" : "budgets"} from ${formatMonth(ctx.month)} on.`;
    return {
      ok: true,
      message: skipped.length > 0 ? `${addedText} Skipped ${skipped.join(", ")}: already budgeted.` : addedText,
    };
  } catch (error) {
    return problem(error, "addSuggestedBudgets");
  }
}
