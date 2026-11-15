import { SHARED_SPENDING_MODE, WEEK_STARTS_ON } from "@/lib/config";
import { requireHousehold } from "@/lib/data";
import { loadReport } from "@/lib/finance/load-report";
import { reportToCsv } from "@/lib/finance/report";
import { parseReportOptions } from "@/lib/finance/report-options";
import { viewLabel } from "@/lib/finance/view-param";
import type { NextRequest } from "next/server";
import { householdToday } from "@/lib/household-time";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireHousehold();
  const today = householdToday(session.household);
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const options = parseReportOptions(params, session.members, today, WEEK_STARTS_ON);
  const { report } = await loadReport(session, options);
  const contributions =
    options.view.kind === "shared"
      ? "paid-in-by-both"
      : options.view.kind === "person" && SHARED_SPENDING_MODE === "separate"
        ? "paid-into-shared"
        : null;
  const name = `spending-${viewLabel(options.view, session.members).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${today}.csv`;

  return new Response(reportToCsv(report, options.periods, contributions), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
