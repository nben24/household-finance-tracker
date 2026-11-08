import type { Metadata } from "next";
import Link from "next/link";
import { FlowColumns } from "@/components/charts/flow-columns";
import { PaceLines } from "@/components/charts/pace-lines";
import { PurchaseScatter } from "@/components/charts/purchase-scatter";
import { SpendingDonut } from "@/components/charts/spending-donut";
import { Card, PageHeader, Stepper } from "@/components/ui";
import { ViewSwitcher } from "@/components/view-switcher";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/config";
import { requireHousehold } from "@/lib/data";
import { addMonths, formatMonth, isMonthKey, monthKey, todayInTimeZone } from "@/lib/dates";
import { flowSentence, OTHER, paceSentence, purchasesSentence, slicesSentence } from "@/lib/finance/charts";
import { loadCharts } from "@/lib/finance/load-charts";
import { parseView, viewLabel, viewParam, viewPersonFilter } from "@/lib/finance/view-param";
import { firstParam, queryString } from "@/lib/params";

export const metadata: Metadata = { title: "Charts" };

const RANGES = [6, 12] as const;

/** The chart's plain-English reading, right under its title. */
function Reading({ children }: { children: string }) {
  return <p className="-mt-2 mb-4 max-w-prose text-sm text-muted">{children}</p>;
}

export default async function ChartsPage({ searchParams }: PageProps<"/charts">) {
  const session = await requireHousehold();
  const params = await searchParams;
  const today = todayInTimeZone(HOUSEHOLD_TIME_ZONE);
  const thisMonth = monthKey(today);
  const requested = firstParam(params.month) ?? "";
  const month = isMonthKey(requested) && requested <= thisMonth ? requested : thisMonth;
  const range = RANGES.find((r) => String(r) === firstParam(params.range)) ?? 6;
  const view = parseView(firstParam(params.view), session.members);
  const viewValue = view.kind === "everyone" ? undefined : viewParam(view);
  const { slices, flow, pace, purchases } = await loadCharts(session, view, month, range, today);

  const query = (overrides: Record<string, string | number | undefined>) =>
    `/charts${queryString({ view: viewValue, month: month === thisMonth ? undefined : month, range: range === 6 ? undefined : range, ...overrides })}`;
  const transactionsFor = (category?: string) =>
    `/transactions${queryString({ month, person: viewPersonFilter(view), category })}`;
  const hrefFor = Object.fromEntries(
    slices.map((slice) => [slice.id, transactionsFor(slice.id === OTHER ? undefined : slice.id)]),
  );

  return (
    <>
      <PageHeader title="Charts" subtitle={`${viewLabel(view, session.members)} · ${session.household.name}`}>
        <Stepper
          label={formatMonth(month)}
          previousHref={query({ month: addMonths(month, -1) })}
          nextHref={
            month < thisMonth
              ? query({ month: addMonths(month, 1) === thisMonth ? undefined : addMonths(month, 1) })
              : null
          }
        />
      </PageHeader>
      <ViewSwitcher
        path="/charts"
        current={view}
        members={session.members}
        params={{ month: month === thisMonth ? undefined : month, range: range === 6 ? undefined : range }}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Where the money went · ${formatMonth(month)}`}>
          <Reading>{slicesSentence(slices, month)}</Reading>
          {slices.length > 0 && <SpendingDonut slices={slices} hrefFor={hrefFor} />}
        </Card>

        <Card title={month === thisMonth ? "Are we on pace?" : `Spending through ${formatMonth(month)}`}>
          <Reading>{paceSentence(pace)}</Reading>
          <PaceLines pace={pace} />
        </Card>

        <Card
          className="lg:col-span-2"
          title="Money in vs. money out"
          action={
            <nav aria-label="How many months" className="flex rounded-lg border border-line p-0.5 text-xs">
              {RANGES.map((r) => (
                <Link
                  key={r}
                  href={query({ range: r === 6 ? undefined : r })}
                  aria-current={r === range ? "true" : undefined}
                  className={`rounded-md px-2 py-1 font-medium ${r === range ? "bg-accent-soft text-accent" : "text-muted hover:text-text"}`}
                >
                  {r} months
                </Link>
              ))}
            </nav>
          }
        >
          <Reading>{flowSentence(flow)}</Reading>
          <FlowColumns flow={flow} incomeLabel={view.kind === "shared" ? "Paid in + income" : "Money in"} />
        </Card>

        <Card className="lg:col-span-2" title={`Purchases · ${formatMonth(month)}`}>
          <Reading>{purchasesSentence(purchases, month)}</Reading>
          {purchases.length > 0 && (
            <PurchaseScatter purchases={purchases} month={month} daysInMonth={pace.daysInMonth} />
          )}
        </Card>
      </div>
    </>
  );
}
