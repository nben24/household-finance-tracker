"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { SettingsResult } from "@/app/(app)/settings/actions";
import { getDataSource, requireHousehold } from "@/lib/data";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import type { RecurringStatus } from "@/lib/db/types";

const STATUSES: (RecurringStatus | null)[] = ["not_recurring", "stopped", null];

export async function markRecurring(input: { key: string; status: RecurringStatus | null }): Promise<SettingsResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: "This is the demo with made-up data, so nothing can be saved here." };
    const key = String(input.key ?? "").slice(0, 300);
    if (!key || !STATUSES.includes(input.status)) return { ok: false, error: "Something about that wasn't right." };
    await getDataSource().setRecurringOverride(session.household.id, key, input.status);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    console.error("markRecurring failed", error instanceof Error ? error.message : error);
    const needsUpdate = error instanceof Error && error.message === MISSING_MIGRATION;
    return { ok: false, error: needsUpdate ? MISSING_MIGRATION : "Something went wrong. Please try again." };
  }
}
