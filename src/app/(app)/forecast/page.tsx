import type { Metadata } from "next";
import Link from "next/link";
import { IncomeForm, IncomeRow } from "@/components/forecast/income-form";
import { Card, Metric, PageHeader } from "@/components/ui";
import { ViewSwitcher } from "@/components/view-switcher";
import { requireHousehold } from "@/lib/data";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/config";
import { addMonths, formatDay, formatDayWithYear, formatMonth, monthKey, todayInTimeZone } from "@/lib/dates";
import type { ExpectedItem, Range } from "@/lib/finance/forecast";
import { loadForecast } from "@/lib/finance/load-forecast";
import { parseView, viewLabel, viewParam } from "@/lib/finance/view-param";
import { formatCentsRounded } from "@/lib/money";
import { firstParam, queryString } from "@/lib/params";

export const metadata: Metadata = { title: "Forecast" };

const FREQUENCY_WORDS = { weekly: "every week", biweekly: "every two weeks", semimonthly: "twice a month", monthly: "monthly" };

function rangeText(range: Range): string {
  if (range.lowCents === range.highCents) return formatCentsRounded(range.expectedCents);
  return `likely ${formatCentsRounded(range.lowCents)}–${formatCentsRounded(range.highCents)}`;
}

function Line({ label, cents, sign, note, strong }: { label: string; cents: number; sign: "+" | "−" | "="; note?: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? "font-semibold" : ""}`}>
      <span className="min-w-0">
        {label}
        {note && <span className="block text-xs font-normal text-muted">{note}</span>}
      </span>
      <span className="shrink-0 tabular">
        {sign === "=" ? "" : sign}
        {formatCentsRounded(Math.abs(cents))}
      </span>
    </div>
  );
}

function ItemList({ items }: { items: ExpectedItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mb-1 ml-3 border-l border-line pl-3 text-xs text-muted">
      {items.map((item, index) => (
        <li key={`${item.name}-${item.date}-${index}`} className="flex justify-between gap-3 py-0.5">
          <span className="truncate">
            {item.name} · {formatDay(item.date)}
          </span>
          <span className="tabular">{formatCentsRounded(item.cents)}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function ForecastPage({ searchParams }: PageProps<"/forecast">) {
  const session = await requireHousehold();
  const params = await searchParams;
  const view = parseView(firstParam(params.view), session.members);
  const viewValue = view.kind === "everyone" ? undefined : viewParam(view);
  const thisMonth = monthKey(todayInTimeZone(HOUSEHOLD_TIME_ZONE));
  const month = firstParam(params.month) === addMonths(thisMonth, 1) ? addMonths(thisMonth, 1) : thisMonth;
  const { forecast, categories, sources } = await loadForecast(session, view, month);
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const people = session.members.map((member) => ({ id: member.id, name: member.name }));
  const personName = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? "") : "Shared");
  const isThisMonth = month === thisMonth;
  const f = forecast;

  const toggle = (target: string, label: string) => (
    <Link
      href={`/forecast${queryString({ month: target === thisMonth ? undefined : target, view: viewValue })}`}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
        target === month ? "bg-accent-soft text-accent" : "text-muted hover:text-text"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader title={`Forecast · ${formatMonth(month)}`} subtitle={`${viewLabel(view, session.members)} · ${session.household.name}`}>
        <nav aria-label="Which month" className="flex rounded-xl border border-line bg-surface p-1">
          {toggle(thisMonth, "This month")}
          {toggle(addMonths(thisMonth, 1), "Next month")}
        </nav>
      </PageHeader>
      <ViewSwitcher
        path="/forecast"
        current={view}
        members={session.members}
        params={{ month: month === thisMonth ? undefined : month }}
      />

      {f.historyMonths === 0 && (
        <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          There isn&apos;t a full month of history yet, so everyday spending can&apos;t be estimated. The forecast only
          includes what&apos;s already happened, recurring bills, and expected income.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Expected income" value={formatCentsRounded(f.incomeCents)} hint={isThisMonth ? `${formatCentsRounded(f.incomeReceivedCents)} so far` : undefined} />
        <Metric label="Projected spending" value={formatCentsRounded(f.spending.expectedCents)} hint={rangeText(f.spending)} />
        {isThisMonth && <Metric label="Spent so far" value={formatCentsRounded(f.spentSoFarCents)} hint={`through ${formatDay(f.cutoff)}`} />}
        <Metric label="Projected left over" value={formatCentsRounded(f.leftOver.expectedCents)} hint={rangeText(f.leftOver)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-start">
        <Card title={`${formatMonth(month)} cash flow`}>
          <ul className="divide-y divide-line text-sm">
            <li>
              <Line
                label="Expected income"
                cents={f.incomeCents}
                sign="+"
                note={isThisMonth ? `${formatCentsRounded(f.incomeReceivedCents)} received, the rest still coming` : undefined}
              />
              <ItemList items={f.incomeToCome} />
            </li>
            {view.kind === "shared" && (
              <li>
                <Line
                  label="Paid in by both of you"
                  cents={f.contributions.soFarCents + f.contributions.toComeCents}
                  sign="+"
                  note={`${formatCentsRounded(f.contributions.soFarCents)} so far, the rest based on a typical month`}
                />
              </li>
            )}
            {isThisMonth && (
              <li>
                <Line label="Spent so far" cents={f.spentSoFarCents} sign="−" />
              </li>
            )}
            <li>
              <Line label="Recurring bills still to come" cents={f.recurringToCome.reduce((t, i) => t + i.cents, 0)} sign="−" />
              <ItemList items={f.recurringToCome} />
            </li>
            <li>
              <Line
                label="Expected everyday spending"
                cents={f.everyday.expectedCents}
                sign="−"
                note={`groceries, restaurants, gas and the like · ${rangeText(f.everyday)}`}
              />
            </li>
            <li>
              <Line label="Expected irregular spending" cents={f.irregularCents} sign="−" note="gifts, medical, travel, car repairs — averaged out" />
            </li>
            {view.kind === "person" && (
              <li>
                <Line
                  label="Paid into the shared account"
                  cents={f.contributions.soFarCents + f.contributions.toComeCents}
                  sign="−"
                  note={`${formatCentsRounded(f.contributions.soFarCents)} so far, the rest based on a typical month`}
                />
              </li>
            )}
            {f.setAsideSoFarCents !== 0 && (
              <li>
                <Line
                  label="Saved & invested so far"
                  cents={f.setAsideSoFarCents}
                  sign="−"
                  note="already moved to savings or investments this month"
                />
              </li>
            )}
            <li>
              <Line label="Projected left over" cents={f.leftOver.expectedCents} sign="=" note={rangeText(f.leftOver)} strong />
            </li>
          </ul>
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Three ways to estimate the month">
            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex justify-between gap-3">
                <span>
                  Average month
                  <span className="block text-xs text-muted">the last {f.historyMonths || "few"} months</span>
                </span>
                <span className="tabular">{formatCentsRounded(f.baselines.historicalAverageCents)}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span>
                  Recent months, weighted
                  <span className="block text-xs text-muted">the last 3, most recent counting most</span>
                </span>
                <span className="tabular">{formatCentsRounded(f.baselines.recentWeightedCents)}</span>
              </li>
              <li className="flex justify-between gap-3 font-semibold">
                <span>
                  Bills plus usual spending
                  <span className="block text-xs font-normal text-muted">the breakdown on the left</span>
                </span>
                <span className="tabular">{formatCentsRounded(f.baselines.detailedCents)}</span>
              </li>
            </ul>
            <p className="mt-3 text-xs text-muted">
              Estimates from your own history, not guarantees. When the three are far apart, the month is harder to predict.
            </p>
          </Card>

          <Card title="By category">
            {f.byCategory.length === 0 ? (
              <p className="text-sm text-muted">Not enough history yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-1 font-medium">Category</th>
                    {isThisMonth && <th className="pb-1 text-right font-medium">So far</th>}
                    <th className="pb-1 text-right font-medium">Typical</th>
                    <th className="pb-1 text-right font-medium">Range</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {f.byCategory.slice(0, 10).map((category) => (
                    <tr key={category.id ?? "none"}>
                      <td className="py-1.5">{category.id ? names.get(category.id) : "Not yet categorized"}</td>
                      {isThisMonth && <td className="py-1.5 text-right tabular">{formatCentsRounded(category.soFarCents)}</td>}
                      <td className="py-1.5 text-right tabular">{formatCentsRounded(category.typicalCents)}</td>
                      <td className="py-1.5 text-right text-xs text-muted tabular">
                        {formatCentsRounded(category.lowCents)}–{formatCentsRounded(category.highCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-4" title="Expected income">
        <p className="mb-3 max-w-prose text-xs text-muted">
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
