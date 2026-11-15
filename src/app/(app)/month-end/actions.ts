"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { SettingsResult } from "@/app/(app)/settings/actions";
import { getDataSource, requireHousehold } from "@/lib/data";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import { formatMonth, isMonthKey, monthKey, monthRange } from "@/lib/dates";
import { sharedSnapshot } from "@/lib/finance/month-end";
import { viewOptions } from "@/lib/finance/view-options";
import { householdToday } from "@/lib/household-time";

/** Marks a finished month as reviewed, remembering its totals (never locks it). */
export async function closeMonth(input: { month: string }): Promise<SettingsResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: "This is the demo with made-up data, so nothing can be saved here." };
    const month = String(input.month ?? "");
    const today = householdToday(session.household);
    if (!isMonthKey(month) || month >= monthKey(today)) return { ok: false, error: "Only a finished month can be closed." };
    const data = getDataSource();
    const { rows } = await data.listTransactions(session.household.id, monthRange(month));
    await data.saveMonthClosing(session.household.id, { month, ...sharedSnapshot(rows, today, viewOptions(session)) });
    revalidatePath("/month-end");
    return { ok: true, message: `${formatMonth(month)} is marked as reviewed. Later refunds and corrections are still welcome — changes will be pointed out here.` };
  } catch (error) {
    unstable_rethrow(error);
    console.error("closeMonth failed", error instanceof Error ? error.message : error);
    const needsUpdate = error instanceof Error && error.message === MISSING_MIGRATION;
    return { ok: false, error: needsUpdate ? MISSING_MIGRATION : "Something went wrong. Please try again." };
  }
}
