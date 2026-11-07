"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { SettingsResult } from "@/app/(app)/settings/actions";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/config";
import { getDataSource, requireHousehold } from "@/lib/data";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import { isISODate, todayInTimeZone } from "@/lib/dates";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/db/types";
import { isUuid } from "@/lib/params";

const DEMO_MESSAGE = "This is the demo with made-up data, so nothing can be saved here.";

function problem(error: unknown, action: string): { ok: false; error: string } {
  unstable_rethrow(error);
  console.error(`${action} failed`, error instanceof Error ? error.message : error);
  const needsUpdate = error instanceof Error && error.message === MISSING_MIGRATION;
  return { ok: false, error: needsUpdate ? MISSING_MIGRATION : "Something went wrong. Please try again." };
}

function parseBalance(value: unknown): number | null {
  const text = String(value ?? "").replace(/[$,\s]/g, "");
  if (text === "") return null;
  const amount = Math.round(Number(text) * 100) / 100;
  return Number.isFinite(amount) && Math.abs(amount) < 1e11 ? amount : null;
}

function parseDate(value: unknown): string | null {
  const date = String(value ?? "");
  return isISODate(date) && date <= todayInTimeZone(HOUSEHOLD_TIME_ZONE) ? date : null;
}

async function context() {
  const session = await requireHousehold();
  return session.isDemo ? null : { session, data: getDataSource(), householdId: session.household.id };
}

export async function addNetWorthAccount(input: {
  institution: string;
  name: string;
  type: string;
  ownerId: string;
  balance: string;
  asOf: string;
}): Promise<SettingsResult> {
  try {
    const ctx = await context();
    if (!ctx) return { ok: false, error: DEMO_MESSAGE };
    const institution = String(input.institution ?? "").trim().slice(0, 60);
    const name = String(input.name ?? "").trim().slice(0, 60);
    if (!name) return { ok: false, error: "Give the account a name." };
    if (!ACCOUNT_TYPES.includes(input.type as AccountType)) return { ok: false, error: "Choose what kind of account it is." };
    const ownerId = String(input.ownerId ?? "");
    if (ownerId && !ctx.session.members.some((member) => member.id === ownerId)) {
      return { ok: false, error: "Choose whose it is." };
    }
    const balance = parseBalance(input.balance);
    const asOf = parseDate(input.asOf);
    if (balance === null) return { ok: false, error: "Enter the current balance." };
    if (!asOf) return { ok: false, error: "Choose a date that isn't in the future." };

    const account = await ctx.data.createAccount(ctx.householdId, {
      institution: institution || name,
      account_name: name,
      account_type: input.type as AccountType,
      owner_user_id: ownerId || null,
      last_four: null,
    });
    await ctx.data.saveBalance(ctx.householdId, { account_id: account.id, as_of: asOf, balance });
    revalidatePath("/", "layout");
    return { ok: true, message: `Added ${name}.` };
  } catch (error) {
    return problem(error, "addNetWorthAccount");
  }
}

export async function updateBalance(input: { accountId: string; balance: string; asOf: string }): Promise<SettingsResult> {
  try {
    const ctx = await context();
    if (!ctx) return { ok: false, error: DEMO_MESSAGE };
    const accounts = await ctx.data.listAccounts(ctx.householdId);
    if (!accounts.some((account) => account.id === input.accountId)) return { ok: false, error: "That account no longer exists." };
    const balance = parseBalance(input.balance);
    const asOf = parseDate(input.asOf);
    if (balance === null) return { ok: false, error: "Enter the balance." };
    if (!asOf) return { ok: false, error: "Choose a date that isn't in the future." };
    await ctx.data.saveBalance(ctx.householdId, { account_id: input.accountId, as_of: asOf, balance });
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved." };
  } catch (error) {
    return problem(error, "updateBalance");
  }
}

export async function removeBalance(id: string): Promise<SettingsResult> {
  try {
    const ctx = await context();
    if (!ctx) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(id))) return { ok: false, error: "That balance no longer exists." };
    await ctx.data.deleteBalance(ctx.householdId, id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return problem(error, "removeBalance");
  }
}

/** Retired accounts (closed, sold, paid off) leave net worth but keep their history. */
export async function setAccountActive(input: { accountId: string; active: boolean }): Promise<SettingsResult> {
  try {
    const ctx = await context();
    if (!ctx) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(input.accountId))) return { ok: false, error: "That account no longer exists." };
    await ctx.data.updateAccount(ctx.householdId, input.accountId, { is_active: Boolean(input.active) });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return problem(error, "setAccountActive");
  }
}
