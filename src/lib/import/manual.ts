import type { AccountRow } from "@/lib/db/types";

/** The account picker's value for "Cash (create my cash account)". */
export const NEW_CASH_ACCOUNT = "new-cash";

/** Cash is never in a bank download, so entries on it don't wait to post. */
export function isCashAccount(account: Pick<AccountRow, "institution">): boolean {
  return account.institution.trim().toLowerCase() === "cash";
}

/** Hand-added entries this many days old that still haven't posted get pointed out. */
export const STILL_WAITING_AFTER_DAYS = 10;
