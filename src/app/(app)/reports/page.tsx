import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { ViewSwitcher } from "@/components/view-switcher";
import { HOUSEHOLD_TIME_ZONE, SHARED_SPENDING_MODE, WEEK_STARTS_ON } from "@/lib/config";
import { requireHousehold } from "@/lib/data";
import { todayInTimeZone } from "@/lib/dates";
import { loadReport } from "@/lib/finance/load-report";
import { MONTH_COUNTS, WEEK_COUNTS, parseReportOptions, reportQuery } from "@/lib/finance/report-options";
import { viewLabel, viewPersonFilter } from "@/lib/finance/view-param";
import { PAYBACK_GROUP } from "@/lib/finance/views";
import { formatCentsRounded } from "@/lib/money";
import { queryString } from "@/lib/params";

export const metadata: Metadata = { title: "Reports" };

function Choice({ href, selected, children }: { href: string; selected: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
        selected ? "bg-accent-soft text-accent" : "text-muted hover:text-text"
      }`}
    >
      {children}
    </Link>
  );
}

const money = (cents: number) => (cents === 0 ? "–" : formatCentsRounded(cents));

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const session = await requireHousehold();
  const today = todayInTimeZone(HOUSEHOLD_TIME_ZONE);
  const options = parseReportOptions(await searchParams, session.members, today, WEEK_STARTS_ON);
  const { report } = await loadReport(session, options);
  const { periods, view } = options;

  const query = reportQuery(options);
  const href = (changes: Record<string, string | number | undefined>) => `/reports${queryString({ ...query, ...changes })}`;
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const showContributions = view.kind !== "everyone" && SHARED_SPENDING_MODE === "separate";
  const person = viewPersonFilter(view);
  const counts = options.period === "week" ? WEEK_COUNTS : MONTH_COUNTS;

  const cell = "whitespace-nowrap px-3 py-2 text-right tabular";
  const sticky = "sticky left-0 z-10 bg-surface";

  return (
    <>
      <PageHeader title="Reports" subtitle={`Spending by category · ${viewLabel(view, session.members)}`}>
        <a
          href={`/reports/export${queryString(query)}`}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-bg"
        >
          Download spreadsheet (CSV)
        </a>
      </PageHeader>

      <ViewSwitcher
        path="/reports"
        current={view}
        members={session.members}
        params={{ ...query, view: undefined }}
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex gap-1">
          <Choice href={href({ period: undefined, count: undefined })} selected={options.period === "month"}>
            Monthly
          </Choice>
          <Choice href={href({ period: "week", count: undefined })} selected={options.period === "week"}>
            Weekly
          </Choice>
        </div>
        <div className="flex gap-1">
          {counts.map((count) => (
            <Choice key={count} href={href({ count })} selected={options.count === count}>
              {count} {options.period === "week" ? "weeks" : "months"}
            </Choice>
          ))}
        </div>
        <div className="flex gap-1">
          <Choice href={href({ detail: undefined })} selected={options.level === "category"}>
            Categories
          </Choice>
          <Choice href={href({ detail: "subcategory" })} selected={options.level === "subcategory"}>
            Detailed
          </Choice>
        </div>
      </div>

      <Card className="p-0 sm:p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <th className={`${sticky} px-3 py-2 text-left font-medium`}>Category</th>
                {periods.map((period) => (
                  <th key={period.from} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                    <Link
                      href={`/transactions${queryString(
                        options.period === "week"
                          ? { week: period.from, person }
                          : { month: period.from.slice(0, 7), person },
                      )}`}
                      className="hover:text-text hover:underline"
                    >
                      {period.label}
                    </Link>
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Average</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={periods.length + 3} className="px-3 py-4 text-muted">
                    No spending in this period.
                  </td>
                </tr>
              )}
              {report.rows.map((row) => (
                <tr key={row.id ?? "none"}>
                  <td className={`${sticky} max-w-48 truncate px-3 py-2`}>
                    {row.id && row.id !== PAYBACK_GROUP && options.level === "category" ? (
                      <Link
                        href={`/transactions${queryString({ month: "all", category: row.id, person })}`}
                        className="hover:underline"
                      >
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                  </td>
                  {row.cells.map((cents, index) => (
                    <td key={periods[index].from} className={`${cell} ${cents === 0 ? "text-muted" : ""}`}>
                      {money(cents)}
                    </td>
                  ))}
                  <td className={`${cell} font-medium`}>{money(row.total)}</td>
                  <td className={`${cell} text-muted`}>{money(Math.round(row.total / periods.length))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line">
              {[
                { label: "Total spending", values: report.spending, strong: true },
                { label: "Income", values: report.income, strong: false },
                ...(showContributions
                  ? [{ label: "Paid into shared", values: report.contributions, strong: false }]
                  : view.kind === "shared"
                    ? [{ label: "Paid in", values: report.contributions, strong: false }]
                    : []),
                { label: "Saved & invested", values: report.setAside, strong: false },
                { label: "Left over", values: report.net, strong: true },
              ].map(({ label, values, strong }) => (
                <tr key={label} className={strong ? "font-semibold" : "text-muted"}>
                  <td className={`${sticky} px-3 py-2`}>{label}</td>
                  {values.map((cents, index) => (
                    <td key={periods[index].from} className={cell}>
                      {money(cents)}
                    </td>
                  ))}
                  <td className={cell}>{money(sum(values))}</td>
                  <td className={cell}>{money(Math.round(sum(values) / periods.length))}</td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      </Card>
      <p className="mt-3 text-xs text-muted">
        {options.period === "week"
          ? `Weeks start on ${WEEK_STARTS_ON === "sunday" ? "Sunday" : "Monday"}. `
          : ""}
        The current {options.period} so far is included. Transfers, card payments and investing are never counted as
        spending.
      </p>
    </>
  );
}
