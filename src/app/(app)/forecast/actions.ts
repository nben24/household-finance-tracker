"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { SettingsResult } from "@/app/(app)/settings/actions";
import { getDataSource, requireHousehold } from "@/lib/data";
import { MISSING_MIGRATION } from "@/lib/data/supabase";
import { isISODate } from "@/lib/dates";
import { INCOME_FREQUENCIES, type IncomeFrequency } from "@/lib/db/types";
import { isUuid } from "@/lib/params";

const DEMO_MESSAGE = "This is the demo with made-up data, so nothing can be saved here.";

function problem(error: unknown, action: string): { ok: false; error: string } {
  unstable_rethrow(error);
  console.error(`${action} failed`, error instanceof Error ? error.message : error);
  const needsUpdate = error instanceof Error && error.message === MISSING_MIGRATION;
  return { ok: false, error: needsUpdate ? MISSING_MIGRATION : "Something went wrong. Please try again." };
}

export async function saveIncome(input: {
  id?: string;
  personId: string;
  name: string;
  amount: string;
  frequency: string;
  anchorDate: string;
  secondDay: string;
}): Promise<SettingsResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    const name = String(input.name ?? "").trim().slice(0, 60);
    const amount = Math.round(Number(String(input.amount ?? "").replace(/[$,\s]/g, "")) * 100) / 100;
    const frequency = input.frequency as IncomeFrequency;
    const personId = String(input.personId ?? "");
    const secondDay = Number(input.secondDay);
    if (!name) return { ok: false, error: "Give it a name, like “John's paycheck”." };
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 10_000_000) return { ok: false, error: "Enter the take-home amount." };
    if (!INCOME_FREQUENCIES.includes(frequency)) return { ok: false, error: "Choose how often it's paid." };
    if (!isISODate(String(input.anchorDate))) return { ok: false, error: "Enter a recent pay date." };
    if (frequency === "semimonthly" && !(Number.isInteger(secondDay) && secondDay >= 1 && secondDay <= 31)) {
      return { ok: false, error: "Enter the other payday (a day of the month, 1–31)." };
    }
    if (personId && !session.members.some((member) => member.id === personId)) return { ok: false, error: "Choose whose it is." };
    if (input.id && !isUuid(input.id)) return { ok: false, error: "That entry no longer exists." };

    await getDataSource().saveIncomeSource(
      session.household.id,
      {
        person_id: personId || null,
        name,
        amount,
        frequency,
        anchor_date: input.anchorDate,
        second_day: frequency === "semimonthly" ? secondDay : null,
      },
      input.id,
    );
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved." };
  } catch (error) {
    return problem(error, "saveIncome");
  }
}

export async function removeIncome(id: string): Promise<SettingsResult> {
  try {
    const session = await requireHousehold();
    if (session.isDemo) return { ok: false, error: DEMO_MESSAGE };
    if (!isUuid(String(id))) return { ok: false, error: "That entry no longer exists." };
    await getDataSource().deleteIncomeSource(session.household.id, id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return problem(error, "removeIncome");
  }
}
