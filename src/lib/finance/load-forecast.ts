import "server-only";
import { HOUSEHOLD_TIME_ZONE, SHARED_SPENDING_MODE } from "@/lib/config";
import { earliestTransactionDate, getDataSource, type HouseholdContext } from "@/lib/data";
import { addMonths, monthRange, todayInTimeZone } from "@/lib/dates";
import type { IncomeSourceRow } from "@/lib/db/types";
import { forecastMonth, scheduleDates, type ExpectedItem } from "./forecast";
import { activeItems, loadRecurring } from "./load-recurring";
import { upcoming } from "./recurring";
import { viewEntries, type View } from "./views";

/** Expected income in a view: what people entered, or detected paychecks for anyone who hasn't. */
function expectedIncome(
  sources: IncomeSourceRow[],
  detected: { merchant: string; personId: string | null; dates: string[]; cents: number }[],
  view: View,
  from: string,
  to: string,
): ExpectedItem[] {
  const inView = (personId: string | null) =>
    view.kind === "everyone" ? true : view.kind === "shared" ? personId === null : personId === view.personId;
  const entered = sources.filter((source) => source.is_active && inView(source.person_id));
  const covered = new Set(sources.filter((source) => source.is_active).map((source) => source.person_id ?? "shared"));
  return [
    ...entered.flatMap((source) =>
      scheduleDates(
        { frequency: source.frequency, anchorDate: source.anchor_date, secondDay: source.second_day },
        from,
        to,
      ).map((date) => ({ name: source.name, date, cents: Math.round(source.amount * 100) })),
    ),
    ...detected
      .filter((item) => inView(item.personId) && !covered.has(item.personId ?? "shared"))
      .flatMap((item) => item.dates.map((date) => ({ name: item.merchant, date, cents: item.cents }))),
  ];
}

export async function loadForecast(session: HouseholdContext, view: View, month: string) {
  const data = getDataSource();
  const householdId = session.household.id;
  const today = todayInTimeZone(HOUSEHOLD_TIME_ZONE);
  const range = monthRange(month);
  const [transactions, categories, sources, dataStartsOn, recurring] = await Promise.all([
    data.listTransactions(householdId, { from: `${addMonths(month, -7)}-01`, to: today }),
    data.listCategories(householdId),
    data.listIncomeSources(householdId),
    earliestTransactionDate(householdId),
    loadRecurring(session, view),
  ]);

  const active = activeItems(recurring.items);
  const horizon = Math.max(1, Math.ceil((Date.parse(range.to) - Date.parse(today)) / 86_400_000) + 1);
  const expected = upcoming(active, today, horizon);
  const charges = expected.filter(({ item }) => item.kind === "charge");
  const detectedIncome = active
    .filter((item) => item.kind === "income")
    .map((item) => ({
      merchant: item.merchant,
      personId: item.personId,
      cents: item.amountCents,
      dates: expected.filter((entry) => entry.item.key === item.key).map((entry) => entry.date),
    }));

  const forecast = forecastMonth({
    month,
    today,
    dataStartsOn,
    view,
    entries: viewEntries(transactions.rows, view, { memberCount: session.members.length, mode: SHARED_SPENDING_MODE }),
    irregularSubcategories: new Set(
      categories.filter((c) => c.parent_id !== null && c.default_expense_type === "irregular").map((c) => c.id),
    ),
    recurringCharges: charges.map(({ item, date }) => ({ name: item.merchant, date, cents: item.amountCents })),
    recurringMonthlyCents: active.filter((item) => item.kind === "charge").reduce((total, item) => total + item.monthlyCents, 0),
    income: expectedIncome(sources, detectedIncome, view, range.from, range.to),
  });

  return { forecast, categories, sources, today };
}
