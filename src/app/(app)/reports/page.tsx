import type { Metadata } from "next";
import Link from "next/link";
import { secondaryButton } from "@/components/styles";
import { Card, Disclosure, PageHeader, SegmentedLinks, Stepper } from "@/components/ui";
import { ViewSwitcher } from "@/components/view-switcher";
import { SHARED_SPENDING_MODE, WEEK_STARTS_ON } from "@/lib/config";
import { requireHousehold } from "@/lib/data";
import { addMonths, formatMonth, monthKey } from "@/lib/dates";
import { loadCoverage } from "@/lib/finance/load-coverage";
import { loadReport } from "@/lib/finance/load-report";
import { MONTH_COUNTS, WEEK_COUNTS, parseReportOptions, reportQuery } from "@/lib/finance/report-options";
import { viewLabel, viewPersonFilter } from "@/lib/finance/view-param";
import { PAYBACK_GROUP } from "@/lib/finance/views";
import { householdToday } from "@/lib/household-time";
import { formatCents, formatCentsRounded } from "@/lib/money";
import { queryString } from "@/lib/params";

export const metadata: Metadata = { title: "Reports" };

const money = (cents: number) => (cents === 0 ? "–" : formatCentsRounded(cents));

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const session = await requireHousehold();
  const today = householdToday(session.household);
  const options = parseReportOptions(await searchParams, session.members, today, WEEK_STARTS_ON);
  const [{ report }, coverage] = await Promise.all([loadReport(session, options), loadCoverage(session.household.id)]);
  const { periods, view } = options;

  const query = reportQuery(options);
  const href = (changes: Record<string, string | number | undefined>) => `/reports${queryString({ ...query, ...changes })}`;
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const contributionLabel =
    view.kind === "shared" ? "Paid in by both of you" : view.kind === "person" && SHARED_SPENDING_MODE === "separate" ? "Paid into shared" : null;
  const person = viewPersonFilter(view);
  const counts = options.period === "week" ? WEEK_COUNTS : MONTH_COUNTS;
  const thisMonth = monthKey(today);
  const lastShown = periods[periods.length - 1];

  // Which columns are unfinished, or missing some account's activity.
  const columnNote = periods.map((period) =>
    period.to >= today ? "so far" : coverage.isRangeComplete(period.from, period.to) ? null : "partial data",
  );
  const partialCount = columnNote.filter((note) => note === "partial data").length;

  const cell = "whitespace-nowrap px-3 py-2 text-right tabular";
  const sticky = "sticky left-0 z-10 bg-surface";
  const footer = [
    { label: "Total spending", values: report.spending, strong: true },
    { label: "Income", values: report.income, strong: false },
    ...(contributionLabel ? [{ label: contributionLabel, values: report.contributions, strong: false }] : []),
    { label: "Saved & invested", values: report.setAside, strong: false },
    { label: "Cash left over", values: report.net, strong: true },
  ];

  return (
    <>
      <PageHeader title="Reports" subtitle={`Spending by category · ${viewLabel(view, session.members)}`}>
        <a href={`/reports/export${queryString(query)}`} className={secondaryButton}>
          Download this table (CSV)
        </a>
      </PageHeader>

      <ViewSwitcher path="/reports" current={view} members={session.members} params={{ ...query, view: undefined }} />

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SegmentedLinks
          label="Months or weeks"
          options={[
            { href: href({ period: undefined, count: undefined, end: undefined }), label: "Monthly", selected: options.period === "month" },
            { href: href({ period: "week", count: undefined, end: undefined }), label: "Weekly", selected: options.period === "week" },
          ]}
        />
        <SegmentedLinks
          label="How many"
          options={counts.map((count) => ({
            href: href({ count }),
            label: `${count} ${options.period === "week" ? "weeks" : "months"}`,
            selected: options.count === count,
          }))}
        />
        <SegmentedLinks
          label="Detail"
          options={[
            { href: href({ detail: undefined }), label: "Categories", selected: options.level === "category" },
            { href: href({ detail: "subcategory" }), label: "Detailed", selected: options.level === "subcategory" },
          ]}
        />
        <SegmentedLinks
          label="Unfinished period"
          options={[
            { href: href({ complete: undefined }), label: "Include so far", selected: !options.completeOnly },
            { href: href({ complete: 1 }), label: "Completed only", selected: options.completeOnly },
          ]}
        />
        {options.period === "month" && (
          <Stepper
            showLabel
            label={`through ${formatMonth(lastShown.from.slice(0, 7))}`}
            previousHref={href({ end: addMonths(lastShown.from.slice(0, 7), -1) })}
            nextHref={
              lastShown.from.slice(0, 7) < (options.completeOnly ? addMonths(thisMonth, -1) : thisMonth)
                ? href({ end: addMonths(lastShown.from.slice(0, 7), 1) >= thisMonth ? undefined : addMonths(lastShown.from.slice(0, 7), 1) })
                : null
            }
          />
        )}
      </div>

      {/* Phone: totals and averages first; the full table on request. */}
      <Card className="mb-4 md:hidden" title={`Totals over ${periods.length} ${options.period === "week" ? "weeks" : "months"}`}>
        {report.rows.length === 0 ? (
          <p className="text-sm text-muted">No spending in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Total and average spending per category</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="pb-1 font-medium">Category</th>
                <th scope="col" className="pb-1 text-right font-medium">Total</th>
                <th scope="col" className="pb-1 text-right font-medium">Average</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.rows.map((row) => (
                <tr key={row.id ?? "none"}>
                  <th scope="row" className="break-anywhere py-1.5 pr-2 text-left font-normal">{row.name}</th>
                  <td className="py-1.5 text-right tabular">{money(row.total)}</td>
                  <td className="py-1.5 pl-2 text-right text-muted tabular">{money(Math.round(row.total / periods.length))}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <th scope="row" className="py-1.5 text-left">Total spending</th>
                <td className="py-1.5 text-right tabular">{money(sum(report.spending))}</td>
                <td className="py-1.5 pl-2 text-right tabular">{money(Math.round(sum(report.spending) / periods.length))}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>

      <div className="md:hidden">
        <Disclosure summary={`Show each ${options.period === "week" ? "week" : "month"} (wide table)`}>
          <ReportTable />
        </Disclosure>
      </div>
      <div className="hidden md:block">
        <ReportTable />
      </div>

      <p className="mt-3 text-[13px] text-muted">
        Amounts are rounded to whole dollars here; the CSV has exact cents.{" "}
        {options.period === "week" ? `Weeks start on ${WEEK_STARTS_ON === "sunday" ? "Sunday" : "Monday"}. ` : ""}
        {partialCount > 0 &&
          `Columns marked “partial data” are missing some account's activity, so their totals are too low. `}
        Transfers, card payments and investing are never counted as spending. Split purchases count as their parts.
      </p>
      <p className="mt-2 text-[13px] text-muted">
        Need every transaction, or a backup? <Link href="/month-end" className="font-medium text-accent hover:underline">Month-end review</Link> and{" "}
        <Link href="/settings#backup" className="font-medium text-accent hover:underline">Settings</Link> have the full ledger and backup downloads.
      </p>
    </>
  );

  function ReportTable() {
    return (
      <Card className="p-0 sm:p-0">
        <div className="overflow-x-auto" role="region" aria-label="Spending by category, scrolls sideways" tabIndex={0}>
          <table className="w-full text-sm">
            <caption className="sr-only">
              Spending by category for each {options.period}, with totals and averages
            </caption>
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className={`${sticky} px-3 py-2 text-left font-medium`}>
                  Category
                </th>
                {periods.map((period, index) => (
                  <th key={period.from} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">
                    <Link
                      href={`/transactions${queryString(
                        options.period === "week" ? { week: period.from, person } : { month: period.from.slice(0, 7), person },
                      )}`}
                      className="hover:text-text hover:underline"
                    >
                      {period.label}
                    </Link>
                    {columnNote[index] && (
                      <span className={`block font-normal ${columnNote[index] === "partial data" ? "text-notice" : ""}`}>
                        {columnNote[index]}
                      </span>
                    )}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Average</th>
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
                  <th scope="row" className={`${sticky} max-w-48 truncate px-3 py-2 text-left font-normal`} title={row.name}>
                    {row.id && row.id !== PAYBACK_GROUP && options.level === "category" ? (
                      <Link href={`/transactions${queryString({ month: "all", category: row.id, person })}`} className="hover:underline">
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                  </th>
                  {row.cells.map((cents, index) => (
                    <td key={periods[index].from} className={`${cell} ${cents === 0 ? "text-muted" : ""}`} title={cents ? formatCents(cents) : undefined}>
                      {money(cents)}
                    </td>
                  ))}
                  <td className={`${cell} font-medium`} title={formatCents(row.total)}>
                    {money(row.total)}
                  </td>
                  <td className={`${cell} text-muted`}>{money(Math.round(row.total / periods.length))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line">
              {footer.map(({ label, values, strong }) => (
                <tr key={label} className={strong ? "font-semibold" : "text-muted"}>
                  <th scope="row" className={`${sticky} px-3 py-2 text-left font-[inherit]`}>
                    {label}
                  </th>
                  {values.map((cents, index) => (
                    <td key={periods[index].from} className={cell} title={formatCents(cents)}>
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
        <p className="border-t border-line px-3 py-2 text-xs text-muted md:hidden">Scroll sideways for more columns.</p>
      </Card>
    );
  }
}
