// The household's calendar. The time zone is stored on the household (see the
// household_calendar migration) so the app and the database's privacy rules
// agree on what "today" is. HOUSEHOLD_TIME_ZONE is only a fallback for a
// database that hasn't had that update yet.

import { HOUSEHOLD_TIME_ZONE } from "@/lib/config";
import { todayInTimeZone } from "@/lib/dates";
import type { HouseholdRow } from "@/lib/db/types";

export function householdTimeZone(household: Pick<HouseholdRow, "time_zone"> | null | undefined): string {
  const zone = household?.time_zone;
  if (zone && isValidTimeZone(zone)) return zone;
  return HOUSEHOLD_TIME_ZONE;
}

/** Today's date (YYYY-MM-DD) on the household's calendar. */
export function householdToday(
  household: Pick<HouseholdRow, "time_zone"> | null | undefined,
  now: Date = new Date(),
): string {
  return todayInTimeZone(householdTimeZone(household), now);
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Time zones offered in Settings (the household's current one is always added). */
export const COMMON_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;
