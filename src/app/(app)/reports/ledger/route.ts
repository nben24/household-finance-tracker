import type { NextRequest } from "next/server";
import { getDataSource, requireHousehold } from "@/lib/data";
import { isISODate, isMonthKey, monthRange } from "@/lib/dates";
import { ledgerCsv } from "@/lib/finance/export";
import { householdToday } from "@/lib/household-time";

export const dynamic = "force-dynamic";

/**
 * Every transaction you can see in a period, to the cent (?month=YYYY-MM, or
 * ?from=&to=). Read through your own permissions, so the other person's
 * unrevealed private purchases are never included.
 */
export async function GET(request: NextRequest) {
  const session = await requireHousehold();
  const params = request.nextUrl.searchParams;
  const month = params.get("month") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const range = isMonthKey(month)
    ? monthRange(month)
    : isISODate(from) && isISODate(to) && from <= to
      ? { from, to }
      : { from: "1900-01-01", to: householdToday(session.household) };
  const data = getDataSource();
  const [transactions, accounts, categories] = await Promise.all([
    data.listTransactions(session.household.id, range),
    data.listAccounts(session.household.id),
    data.listCategories(session.household.id),
  ]);
  const csv = ledgerCsv(transactions.rows, {
    accounts,
    categories,
    members: session.members.map((member) => ({ id: member.id, name: member.name })),
  });
  const name = `transactions-${isMonthKey(month) ? month : `${range.from}-to-${range.to}`}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
