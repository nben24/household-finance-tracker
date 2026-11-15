import type { Metadata } from "next";
import { IncomeForm, IncomeRow } from "@/components/forecast/income-form";
import { Card, Disclosure, Metric, PageHeader, SegmentedLinks } from "@/components/ui";
import { ViewSwitcher } from "@/components/view-switcher";
import { requireHousehold } from "@/lib/data";
import { householdToday } from "@/lib/household-time";
import { addMonths, formatDay, formatDayWithYear, formatMonth, monthKey } from "@/lib/dates";
import { cashFlowLines, resultLabel, type ExpectedItem, type Range } from "@/lib/finance/forecast";
import { loadForecast } from "@/lib/finance/load-forecast";
import { parseView, viewLabel, viewParam } from "@/lib/finance/view-param";
import { formatCents, formatCentsRounded, formatEffectRounded } from "@/lib/money";
import { firstParam, queryString } from "@/lib/params";

export const metadata: Metadata = { title: "Forecast" };

const FREQUENCY_WORDS = { weekly: "every week", biweekly: "every two weeks", semimonthly: "twice a month", monthly: "monthly" };

/** "likely $5,800–$6,400" for spending. */
function rangeText(range: Range): string {
  if (range.lowCents === range.highCents) return formatCentsRounded(range.expectedCents);
  return `likely ${formatCentsRounded(range.lowCents)}–${formatCentsRounded(range.highCents)}`;
}

/** The result's range, keeping signs: "likely −$200 to +$400". */
function resultRangeText(range: Range): string {
  if (range.lowCents === range.highCents) return formatEffectRounded(range.expectedCents);
  return `likely ${formatEffectRounded(range.lowCents)} to ${formatEffectRounded(range.highCents)}`;
}

function ItemList({ items, title }: { items: ExpectedItem[]; title: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">None expected for the rest of the month.</p>;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{title}</caption>
      <thead>
        <tr className="text-left text-xs text-muted">
          <th scope="col" className="pb-1 font-medium">Name</th>
          <th scope="col" className="pb-1 font-medium">Expected</th>
          <th scope="col" className="pb-1 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {items.map((item, index) => (
          <tr key={`${item.name}-${item.date}-${index}`}>
            <td className="break-anywhere py-1.5 pr-3">{item.name}</td>
            <td className="whitespace-nowrap py-1.5 pr-3 text-muted">{formatDay(item.date)}</td>
            <td className="py-1.5 text-right tabular">{formatCents(item.cents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ForecastPage({ searchParams }: PageProps<"/forecast">) {
  const session = await requireHousehold();
  const params = await searchParams;
  const view = parseView(firstParam(params.view), session.members);
  const viewValue = view.kind === "everyone" ? undefined : viewParam(view);
  const today = householdToday(session.household);
  const thisMonth = monthKey(today);
  const month = firstParam(params.month) === addMonths(thisMonth, 1) ? addMonths(thisMonth, 1) : thisMonth;
  const { forecast: f, categories, sources, coverage } = await loadForecast(session, view, month);
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const people = session.members.map((member) => ({ id: member.id, name: member.name }));
  const personName = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? "") : "Shared");
  const isThisMonth = month === thisMonth;
  const lines = cashFlowLines(f, view, isThisMonth);
  const result = resultLabel(f.leftOver.expectedCents);
  const billsCents = f.recurringToCome.reduce((total, item) => total + item.cents, 0);
  const monthHref = (target: string) =>
    `/forecast${queryString({ month: target === thisMonth ? undefined : target, view: viewValue })}`;

  return (
    <>
      <PageHeader title={`Forecast · ${formatMonth(month)}`} subtitle={`${viewLabel(view, session.members)} · ${session.household.name}`}>
        <SegmentedLinks
          label="Which month"
          options={[
            { href: monthHref(thisMonth), label: "This month", selected: isThisMonth },
            { href: monthHref(addMonths(thisMonth, 1)), label: "Next month", selected: !isThisMonth },
          ]}
        />
      </PageHeader>
      <ViewSwitcher
        path="/forecast"
        current={view}
        members={session.members}
        params={{ month: month === thisMonth ? undefined : month }}
      />

      {f.historyMonths === 0 && (
        <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          There isn&apos;t a complete month of history yet, so everyday spending can&apos;t be estimated. The forecast
          only includes what&apos;s already happened, recurring bills, and expected income.
        </p>
      )}

      {/* The answer first: how much will be spent, and what's left (or short). */}
      <Card className="mb-4">
        <div className="grid gap-5 sm:grid-cols-2">
          <Metric
            size="primary"
            label="Projected spending"
            value={formatCentsRounded(f.spending.expectedCents)}
            hint={
              <>
                {rangeText(f.spending)}
                {isThisMonth && (
                  <>
                    {" · "}
                    {formatCentsRounded(f.spentSoFarCents)} spent through {formatDay(f.cutoff)}
                  </>
                )}
              </>
            }
          />
          <Metric
            size="primary"
            label={result.label}
            value={formatCentsRounded(result.amountCents)}
            tone={result.shortfall ? "notice" : undefined}
            hint={
              result.shortfall
                ? `Expected money in doesn't cover expected money out. ${resultRangeText(f.leftOver)}.`
                : `${resultRangeText(f.leftOver)}. An estimate, not money that's safe to spend.`
            }
          />
        </div>
        {coverage.partialMonths.length > 0 && (
          <p className="mt-4 text-[13px] text-muted">
            Left out of the history because not every account was fully imported:{" "}
            {coverage.partialMonths.map((m) => formatMonth(m)).join(", ")}.
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-start">
        <Card title="How the month adds up">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Each line&apos;s effect on the projected result. Plus adds money, minus takes it away.
            </caption>
            <tbody className="divide-y divide-line">
              {lines.map((line) => (
                <tr key={line.key}>
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {line.label}
                    {line.key === "income" && isThisMonth && (
                      <span className="block text-[13px] text-muted">
                        {formatCentsRounded(f.incomeReceivedCents)} received, the rest still coming
                      </span>
                    )}
                    {line.key === "everyday" && (
                      <span className="block text-[13px] text-muted">groceries, restaurants, gas · {rangeText(f.everyday)}</span>
                    )}
                    {line.key === "irregular" && (
                      <span className="block text-[13px] text-muted">gifts, medical, travel, car repairs — averaged out</span>
                    )}
                    {(line.key === "paid-in" || line.key === "paid-into-shared") && (
                      <span className="block text-[13px] text-muted">
                        {formatCentsRounded(f.contributions.soFarCents)} so far, the rest based on a typical month
                      </span>
                    )}
                  </th>
                  <td className="whitespace-nowrap py-2 text-right tabular">{formatEffectRounded(line.effectCents)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <th scope="row" className="py-2 pr-3 text-left">
                  {result.label}
                </th>
                <td className={`whitespace-nowrap py-2 text-right tabular ${result.shortfall ? "text-notice" : ""}`}>
                  {formatEffectRounded(f.leftOver.expectedCents)}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
            <Disclosure summary={`See bills still to come (${f.recurringToCome.length} · ${formatCentsRounded(billsCents)})`}>
              <ItemList items={f.recurringToCome} title="Recurring bills still to come" />
            </Disclosure>
            <Disclosure summary={`See expected paychecks (${f.incomeToCome.length})`}>
              <ItemList items={f.incomeToCome} title="Expected income still to come" />
            </Disclosure>
            <Disclosure summary="How this estimate works">
              <div className="flex flex-col gap-3 text-sm">
                <p className="max-w-prose text-muted">
                  Projected spending = what&apos;s been spent so far + recurring bills on their expected dates + your
                  usual everyday spending for the rest of the month + irregular spending averaged out. It uses{" "}
                  {f.historyMonths === 0 ? "no" : f.historyMonths} complete{" "}
                  {f.historyMonths === 1 ? "month" : "months"} of history. Estimates from your own history, not
                  guarantees.
                </p>
                <table className="w-full text-sm">
                  <caption className="mb-1 text-left text-[13px] font-medium text-muted">
                    Three ways to estimate the whole month&apos;s spending
                  </caption>
                  <tbody className="divide-y divide-line">
                    <tr>
                      <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                        Average month <span className="block text-[13px] text-muted">the last {f.historyMonths || "few"} complete months</span>
                      </th>
                      <td className="py-1.5 text-right tabular">{formatCentsRounded(f.baselines.historicalAverageCents)}</td>
                    </tr>
                    <tr>
                      <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                        Recent months, weighted <span className="block text-[13px] text-muted">the last 3, most recent counting most</span>
                      </th>
                      <td className="py-1.5 text-right tabular">{formatCentsRounded(f.baselines.recentWeightedCents)}</td>
                    </tr>
                    <tr className="font-semibold">
                      <th scope="row" className="py-1.5 pr-3 text-left">
                        Bills plus usual spending <span className="block text-[13px] font-normal text-muted">the estimate used above</span>
                      </th>
                      <td className="py-1.5 text-right tabular">{formatCentsRounded(f.baselines.detailedCents)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-[13px] text-muted">When the three are far apart, the month is harder to predict.</p>
              </div>
            </Disclosure>
          </div>
        </Card>

        <Card title="By category">
          {f.byCategory.length === 0 ? (
            <p className="text-sm text-muted">Not enough history yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Spending by category: so far, a typical month, and the recent range</caption>
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="pb-1 font-medium">Category</th>
                    {isThisMonth && <th scope="col" className="pb-1 text-right font-medium">So far</th>}
                    <th scope="col" className="pb-1 text-right font-medium">Typical</th>
                    <th scope="col" className="pb-1 text-right font-medium">Range</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {f.byCategory.slice(0, 10).map((category) => (
                    <tr key={category.id ?? "none"}>
                      <th scope="row" className="break-anywhere py-1.5 pr-2 text-left font-normal">
                        {category.id ? names.get(category.id) : "Not yet categorized"}
                      </th>
                      {isThisMonth && <td className="py-1.5 text-right tabular">{formatCentsRounded(category.soFarCents)}</td>}
                      <td className="py-1.5 text-right tabular">{formatCentsRounded(category.typicalCents)}</td>
                      <td className="whitespace-nowrap py-1.5 pl-2 text-right text-xs text-muted tabular">
                        {formatCentsRounded(category.lowCents)}–{formatCentsRounded(category.highCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="Expected income">
        <p className="mb-3 max-w-prose text-[13px] text-muted">
          Enter each paycheck so forecasts are right even before the app has seen several of them. For anyone without an
          entry, the forecast uses paychecks it has detected.
        </p>
        {sources.length > 0 && (
          <ul className="mb-4 divide-y divide-line">
            {sources.map((source) => (
              <li key={source.id} className="py-2">
                {session.isDemo ? (
                  <span className="text-sm">{source.name}</span>
                ) : (
                  <IncomeRow
                    people={people}
                    label={`${personName(source.person_id)} · ${source.name} · ${formatCentsRounded(Math.round(source.amount * 100))} ${
                      source.frequency === "semimonthly"
                        ? `on the ${Number(source.anchor_date.slice(8))}${ordinal(Number(source.anchor_date.slice(8)))} and ${source.second_day}${ordinal(source.second_day ?? 0)}`
                        : `${FREQUENCY_WORDS[source.frequency]} (e.g. ${formatDayWithYear(source.anchor_date)})`
                    }`}
                    entry={{
                      id: source.id,
                      personId: source.person_id ?? "",
                      name: source.name,
                      amount: String(source.amount),
                      frequency: source.frequency,
                      anchorDate: source.anchor_date,
                      secondDay: source.second_day ? String(source.second_day) : "",
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {!session.isDemo && <IncomeForm people={people} />}
      </Card>
    </>
  );
}

function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][day % 10] ?? "th";
}
