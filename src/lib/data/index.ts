import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isDemoMode, isSupabaseConfigured } from "@/lib/config";
import type { HouseholdRow } from "@/lib/db/types";
import { demoDataSource } from "./demo";
import { supabaseDataSource } from "./supabase";
import type { DataSource, SessionContext, TransactionFilter } from "./types";

// While a page renders, the same list is often asked for several times (the
// dashboard's budget, recurring and spending sections all need categories).
// These are fetched once per page load. Outside rendering (saves, imports)
// React's cache does nothing, so a change is always read back fresh.
const cachedSupabase: DataSource = {
  ...supabaseDataSource,
  listAccounts: cache(supabaseDataSource.listAccounts),
  listCategories: cache(supabaseDataSource.listCategories),
  listRules: cache(supabaseDataSource.listRules),
  listBudgetLines: cache(supabaseDataSource.listBudgetLines),
  listRecurringOverrides: cache(supabaseDataSource.listRecurringOverrides),
  listBalances: cache(supabaseDataSource.listBalances),
  listIncomeSources: cache(supabaseDataSource.listIncomeSources),
};

export function getDataSource(): DataSource {
  if (isSupabaseConfigured) return cachedSupabase;
  if (isDemoMode) return demoDataSource;
  throw new Error(
    "The app is not connected to its database. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  );
}

export const getSession = cache(() => getDataSource().getSession());

export type HouseholdContext = SessionContext & { household: HouseholdRow };

/** For pages inside the app: guarantees a signed-in person with a household. */
export async function requireHousehold(): Promise<HouseholdContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.household) redirect("/auth/no-household");
  return session as HouseholdContext;
}

/** Date of the household's earliest transaction, or null when there are none. */
export const earliestTransactionDate = cache(async (householdId: string): Promise<string | null> => {
  const { rows } = await getDataSource().listTransactions(householdId, {}, { limit: 1, offset: 0, sort: "oldest" });
  return rows[0]?.transaction_date ?? null;
});

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
