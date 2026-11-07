import "server-only";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/config";
import { getDataSource, type HouseholdContext } from "@/lib/data";
import { addDays, todayInTimeZone } from "@/lib/dates";
import type { CategoryRow, RecurringStatus } from "@/lib/db/types";
import { detectRecurring, type Recurring } from "./recurring";
import type { View } from "./views";

const HISTORY_DAYS = 400;

export interface RecurringItem extends Recurring {
  status: RecurringStatus | null;
  group: "subscription" | "bill" | "income";
}

/** Everything recurring that belongs in a view, with people's corrections applied. */
export async function loadRecurring(session: HouseholdContext, view: View) {
  const data = getDataSource();
  const householdId = session.household.id;
  const today = todayInTimeZone(HOUSEHOLD_TIME_ZONE);
  const [transactions, overrides, categories] = await Promise.all([
    data.listTransactions(householdId, { from: addDays(today, -HISTORY_DAYS) }),
    data.listRecurringOverrides(householdId),
    data.listCategories(householdId),
  ]);
  const statuses = new Map(overrides.map((override) => [override.recurring_key, override.status]));
  const subscriptions = categories.find((c) => c.parent_id === null && c.name.toLowerCase() === "subscriptions")?.id;

  const items: RecurringItem[] = detectRecurring(transactions.rows, { today })
    .filter((item) =>
      view.kind === "everyone" ? true : view.kind === "shared" ? item.personId === null : item.personId === view.personId,
    )
    .map((item) => ({
      ...item,
      status: statuses.get(item.key) ?? null,
      group: item.kind === "income" ? "income" : item.categoryId && item.categoryId === subscriptions ? "subscription" : "bill",
    }));

  return { today, items, categories };
}

/** Items that count: not marked as a false detection, not stopped, not apparently ended. */
export function activeItems(items: RecurringItem[]): RecurringItem[] {
  return items.filter((item) => item.status === null && !item.maybeStopped);
}

export function categoryLabel(item: Pick<Recurring, "categoryId" | "subcategoryId">, categories: CategoryRow[]): string {
  const name = (id: string | null) => categories.find((category) => category.id === id)?.name;
  const parent = name(item.categoryId);
  const child = name(item.subcategoryId);
  return parent && child ? `${parent} › ${child}` : (parent ?? "Not yet categorized");
}
