"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { SettingsResult } from "@/app/(app)/settings/actions";
import { getDataSource, requireHousehold } from "@/lib/data";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import { addMonths, isMonthKey } from "@/lib/dates";
import { BUDGET_KINDS, type BudgetKind } from "@/lib/db/types";
import { activeIn, conflictsWith, scopeOf, suggestedKind, tidyAmount } from "@/lib/finance/budgets";
import { loadBudget } from "@/lib/finance/load-budget";
import { parseView } from "@/lib/finance/view-param";
import { isUuid } from "@/lib/params";

const DEMO_MESSAGE = "This is the demo with made-up data, so nothing can be saved here.";
const CONFLICT =
  "That category already has a budget here, or is budgeted for the whole household. Change that one instead.";

function problem(error: unknown, action: string): { ok: false; error: string } {
  unstable_rethrow(error);
  console.error(`${action} failed`, error instanceof Error ? error.message : error);
  const needsUpdate = error instanceof Error && error.message === MISSING_MIGRATION;
  return { ok: false, error: needsUpdate ? MISSING_MIGRATION : "Something went wrong. Please try again." };
}

function parseAmount(value: unknown): number | null {
  const amount = Math.round(Number(value) * 100) / 100;
  return Number.isFinite(amount) && amount >= 0 && amount < 10_000_000 ? amount : null;
}

async function context(monthValue: unknown) {
  const session = await requireHousehold();
  const month = String(monthValue ?? "");
  if (session.isDemo || !isMonthKey(month)) return null;
  return { session, month, data: getDataSource(), householdId: session.household.id };
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
    if (conflictsWith(candidate, stillActive)) return { ok: false, error: CONFLICT };

    await ctx.data.createBudgetLine(ctx.householdId, {
      ...candidate,
      kind: input.kind as BudgetKind,
      amount,
      starts_month: fromMonth,
      ends_month: null,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return problem(error, "addBudgetLine");
  }
}

/**
 * Changes take effect from the month being viewed. Months before it keep the
 * budget they had: the old line ends the month before and a new one begins.
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

    const lines = await ctx.data.listBudgetLines(ctx.householdId);
    const line = activeIn(lines, ctx.month).find((candidate) => candidate.id === input.id);
    if (!line) return { ok: false, error: "That budget no longer exists." };
    const fromMonth = `${ctx.month}-01`;

    if (line.starts_month === fromMonth) {
      await ctx.data.updateBudgetLine(ctx.householdId, line.id, { amount, kind: input.kind as BudgetKind });
    } else {
      await ctx.data.updateBudgetLine(ctx.householdId, line.id, { ends_month: `${addMonths(ctx.month, -1)}-01` });
      await ctx.data.createBudgetLine(ctx.householdId, {
        scope: line.scope,
        person_id: line.person_id,
        category_id: line.category_id,
        subcategory_id: line.subcategory_id,
        kind: input.kind as BudgetKind,
        amount,
        starts_month: fromMonth,
        ends_month: line.ends_month,
      });
    }
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return problem(error, "changeBudgetLine");
  }
}

export async function removeBudgetLine(input: { id: string; month: string }): Promise<SettingsResult> {
  try {
    const ctx = await context(input.month);
    if (!ctx) return { ok: false, error: DEMO_MESSAGE };
    const lines = await ctx.data.listBudgetLines(ctx.householdId);
    const line = activeIn(lines, ctx.month).find((candidate) => candidate.id === input.id);
    if (!line) return { ok: false, error: "That budget no longer exists." };

    if (line.starts_month === `${ctx.month}-01`) {
      await ctx.data.deleteBudgetLine(ctx.householdId, line.id);
    } else {
      await ctx.data.updateBudgetLine(ctx.householdId, line.id, { ends_month: `${addMonths(ctx.month, -1)}-01` });
    }
    revalidatePath("/", "layout");
    return { ok: true, message: "Removed from this month on. Earlier months keep it." };
  } catch (error) {
    return problem(error, "removeBudgetLine");
  }
}

/** Adds a budget for each category with recent spending and no budget yet, based on the recent average. */
export async function addSuggestedBudgets(input: { view: string; month: string }): Promise<SettingsResult> {
  try {
    const ctx = await context(input.month);
    if (!ctx) return { ok: false, error: DEMO_MESSAGE };
    const view = parseView(input.view, ctx.session.members);
    const budget = await loadBudget(ctx.session, view, ctx.month);
    if (budget.averageMonths === 0) {
      return { ok: false, error: "There isn't a full month of history yet to suggest from." };
    }

    const scope = scopeOf(view);
    const fromMonth = `${ctx.month}-01`;
    const stillActive = budget.allLines.filter((line) => line.ends_month === null || line.ends_month >= fromMonth);
    let added = 0;
    for (const category of budget.categories.filter((c) => c.parent_id === null && c.is_active)) {
      const amount = tidyAmount(budget.averages[category.id] ?? 0);
      const candidate = { ...scope, category_id: category.id, subcategory_id: null };
      if (amount === 0 || conflictsWith(candidate, stillActive)) continue;
      await ctx.data.createBudgetLine(ctx.householdId, {
        ...candidate,
        kind: suggestedKind(category.id, null, budget.categories),
        amount,
        starts_month: fromMonth,
        ends_month: null,
      });
      stillActive.push({ ...candidate, id: "", household_id: "", kind: "variable", amount, starts_month: fromMonth, ends_month: null, created_at: "" });
      added += 1;
    }
    revalidatePath("/", "layout");
    return {
      ok: true,
      message:
        added === 0
          ? "Every category with recent spending already has a budget."
          : `Added ${added} ${added === 1 ? "budget" : "budgets"} from your last ${budget.averageMonths === 1 ? "month" : `${budget.averageMonths} months`}. Adjust any that don't look right.`,
    };
  } catch (error) {
    return problem(error, "addSuggestedBudgets");
  }
}
