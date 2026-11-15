"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { SettingsResult } from "@/app/(app)/settings/actions";
import { getDataSource, requireHousehold } from "@/lib/data";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import { addDays, formatDayWithYear, isISODate } from "@/lib/dates";
import { householdToday } from "@/lib/household-time";
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

function parseDate(value: unknown, today: string): string | null {
  const date = String(value ?? "");
  return isISODate(date) && date <= today ? date : null;
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
    const asOf = parseDate(input.asOf, householdToday(ctx.session.household));
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
    const asOf = parseDate(input.asOf, householdToday(ctx.session.household));
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

/**
 * Retires an account that was closed, sold or paid off on a date. It counts in
 * net worth before that date (earlier months don't change) and not from it
 * on. An optional final balance is recorded for the day before it closed.
 * This does not record sale proceeds or a payoff: those show up in the
 * account the money went to or came from.
 */
export async function retireAccount(input: {
  accountId: string;
  closedOn: string;
  finalBalance?: string;
}): Promise<SettingsResult> {
  try {
    const ctx = await context();
    if (!ctx) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(input.accountId))) return { ok: false, error: "That account no longer exists." };
    const accounts = await ctx.data.listAccounts(ctx.householdId);
    const account = accounts.find((candidate) => candidate.id === input.accountId);
    if (!account) return { ok: false, error: "That account no longer exists." };
    const closedOn = parseDate(input.closedOn, householdToday(ctx.session.household));
    if (!closedOn) return { ok: false, error: "Choose the date it closed — today or earlier." };
    const finalText = String(input.finalBalance ?? "").trim();
    const finalBalance = finalText === "" ? null : parseBalance(finalText);
    if (finalText !== "" && finalBalance === null) return { ok: false, error: "Enter the final balance as a number, or leave it blank." };

    if (finalBalance !== null) {
      await ctx.data.saveBalance(ctx.householdId, { account_id: account.id, as_of: addDays(closedOn, -1), balance: finalBalance });
    }
    await ctx.data.updateAccount(ctx.householdId, account.id, { is_active: false, closed_on: closedOn });
    revalidatePath("/", "layout");
    return { ok: true, message: `Retired from ${formatDayWithYear(closedOn)}. Earlier months still include it.` };
  } catch (error) {
    return problem(error, "retireAccount");
  }
}

/** Brings a retired account back: listed again and counted on every date. */
export async function restoreAccount(input: { accountId: string }): Promise<SettingsResult> {
  try {
    const ctx = await context();
    if (!ctx) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(input.accountId))) return { ok: false, error: "That account no longer exists." };
    await ctx.data.updateAccount(ctx.householdId, input.accountId, { is_active: true, closed_on: null });
    revalidatePath("/", "layout");
    return { ok: true, message: "Restored." };
  } catch (error) {
    return problem(error, "restoreAccount");
  }
}
