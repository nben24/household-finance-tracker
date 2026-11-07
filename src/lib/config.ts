import type { WeekStart } from "@/lib/dates";
import type { SharedSpendingMode } from "@/lib/finance/views";

export const HOUSEHOLD_TIME_ZONE = process.env.HOUSEHOLD_TIME_ZONE || "America/New_York";

/** First day of the week for Sunday Review. Change with HOUSEHOLD_WEEK_STARTS_ON. */
export const WEEK_STARTS_ON: WeekStart =
  process.env.HOUSEHOLD_WEEK_STARTS_ON?.trim().toLowerCase() === "monday" ? "monday" : "sunday";

/** Spending in "Other" above this many dollars in a month gets pointed out. */
export const OTHER_ALERT_DOLLARS = Number(process.env.HOUSEHOLD_OTHER_ALERT_DOLLARS) || 200;

/**
 * How shared (joint account) spending shows up in each person's view:
 * "separate" — shown under Shared; each person sees what they paid into the shared account
 * "split"    — each person's view includes an equal share of shared spending
 */
export const SHARED_SPENDING_MODE: SharedSpendingMode =
  process.env.HOUSEHOLD_SHARED_SPENDING_IN_PERSONAL === "split" ? "split" : "separate";

/**
 * `npm run demo` sets FORCE_DEMO: synthetic data even on a machine set up for
 * the real database, which is then never contacted.
 */
const forceDemo = process.env.FORCE_DEMO === "true";

export const SUPABASE_URL = forceDemo ? "" : (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
export const SUPABASE_ANON_KEY = forceDemo ? "" : (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Demo mode serves built-in synthetic data with no login. It is only used when
 * Supabase is not configured, and in production only when explicitly enabled.
 */
export const isDemoMode =
  forceDemo ||
  (!isSupabaseConfigured && (process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "true"));
