import type { HouseholdRow } from "@/lib/db/types";
import type { TransactionFilter } from "./types";

/** What belongs in Sunday Review: waiting transactions from the review start date on. */
export function reviewQueueFilter(household: HouseholdRow, extra: TransactionFilter = {}): TransactionFilter {
  return { ...extra, needsReview: true, from: household.review_starts_on ?? undefined };
}

/** What belongs on the Catch-up page: waiting transactions before the review start date. */
export function catchUpFilter(household: HouseholdRow): TransactionFilter | null {
  if (!household.review_starts_on) return null;
  const dayBefore = new Date(`${household.review_starts_on}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  return { needsReview: true, to: dayBefore.toISOString().slice(0, 10) };
}
