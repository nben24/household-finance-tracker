import type { Metadata } from "next";
import { RecurringActions } from "@/components/recurring/recurring-actions";
import { Card, Metric, PageHeader } from "@/components/ui";
import { ViewSwitcher } from "@/components/view-switcher";
import { requireHousehold } from "@/lib/data";
import { addDays, formatDay, formatDayWithYear } from "@/lib/dates";
import type { CategoryRow } from "@/lib/db/types";
import { activeItems, categoryLabel, loadRecurring, type RecurringItem } from "@/lib/finance/load-recurring";
import { FREQUENCY_LABELS, upcoming } from "@/lib/finance/recurring";
import { parseView, viewLabel } from "@/lib/finance/view-param";
import { formatCents, formatCentsRounded } from "@/lib/money";
import { firstParam } from "@/lib/params";

export const metadata: Metadata = { title: "Recurring" };

const UPCOMING_DAYS = 30;

function Item({
  item,
  categories,
  owner,
  readOnly,
}: {
  item: RecurringItem;
  categories: CategoryRow[];
  owner: string | null;
  readOnly: boolean;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {item.merchant}
          {owner && <span className="ml-2 rounded-full bg-bg px-2 py-0.5 text-xs font-normal text-muted">{owner}</span>}
          {item.isNew && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">New</span>}
          {item.confidence === "medium" && item.status === null && (
            <span className="ml-2 text-xs font-normal text-muted">probably</span>
          )}
        </p>
        <p className="text-xs text-muted">
          {categoryLabel(item, categories)} · {FREQUENCY_LABELS[item.frequency]} · last {formatDayWithYear(item.lastDate)}
          {item.status === null && !item.maybeStopped && ` · next ${item.flexibleDay ? "around " : ""}${formatDay(item.nextDate)}`}
        </p>
        {item.oneOffs.length > 0 && (
          <p className="text-xs text-muted">
            Also {item.oneOffs.map((oneOff) => `${formatCents(oneOff.cents)} on ${formatDayWithYear(oneOff.date)}`).join(", ")}{" "}
            (one-off, not counted as the regular amount)
          </p>
        )}
        {item.priceChange && (
          <p className="text-xs text-notice">
            Changed from {formatCents(item.priceChange.fromCents)} to {formatCents(item.priceChange.toCents)} on{" "}
            {formatDay(item.priceChange.date)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <p className="text-sm font-semibold tabular">
          {formatCents(item.amountCents)}
          {item.frequency !== "monthly" && (
            <span className="block text-right text-xs font-normal text-muted">
              ≈ {formatCents(item.monthlyCents)} a month
            </span>
          )}
        </p>
        {!readOnly && <RecurringActions recurringKey={item.key} status={item.status} />}
      </div>
    </li>
  );
}

export default async function RecurringPage({ searchParams }: PageProps<"/recurring">) {
  const session = await requireHousehold();
  const view = parseView(firstParam((await searchParams).view), session.members);
  const { today, items, categories } = await loadRecurring(session, view);
  const memberNames = new Map(session.members.map((member) => [member.id, member.name]));
  const ownerOf = (item: RecurringItem) =>
    view.kind === "everyone" ? (item.personId ? (memberNames.get(item.personId) ?? null) : "Shared") : null;

  const active = activeItems(items);
  const charges = active.filter((item) => item.kind === "charge");
  const subscriptions = active.filter((item) => item.group === "subscription");
  const bills = active.filter((item) => item.group === "bill");
  const income = active.filter((item) => item.group === "income");
  const sum = (list: RecurringItem[], field: "monthlyCents" | "annualCents") => list.reduce((t, i) => t + i[field], 0);
  // New in the last ~6 weeks, or a price change in that time.
  const recently = addDays(today, -45);
  const changes = charges.filter((item) => item.isNew || (item.priceChange && item.priceChange.date >= recently));
  const soon = upcoming(active, today, UPCOMING_DAYS);
  const ended = items.filter((item) => item.status === "stopped" || (item.status === null && item.maybeStopped));
  const hidden = items.filter((item) => item.status === "not_recurring");

  // Subscriptions grouped by their subcategory (Streaming, AI / Software, …).
  const bySubcategory = new Map<string, RecurringItem[]>();
  for (const item of subscriptions) {
    const label = categories.find((c) => c.id === item.subcategoryId)?.name ?? "Other";
    bySubcategory.set(label, [...(bySubcategory.get(label) ?? []), item]);
  }

  const list = (entries: RecurringItem[], empty: string) =>
    entries.length === 0 ? (
      <p className="text-sm text-muted">{empty}</p>
    ) : (
      <ul className="divide-y divide-line">
        {entries.map((item) => (
          <Item key={item.key} item={item} categories={categories} owner={ownerOf(item)} readOnly={session.isDemo} />
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader
        title="Recurring"
        subtitle={`Regular bills, subscriptions and income · ${viewLabel(view, session.members)}`}
      />
      <ViewSwitcher path="/recurring" current={view} members={session.members} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Recurring charges" value={formatCentsRounded(sum(charges, "monthlyCents"))} hint="a month" />
        <Metric label="Per year" value={formatCentsRounded(sum(charges, "annualCents"))} hint="at today's prices" />
        <Metric
          label="Subscriptions"
          value={formatCentsRounded(sum(subscriptions, "monthlyCents"))}
          hint={`a month · ${formatCentsRounded(sum(subscriptions, "annualCents"))} a year`}
        />
        <Metric label="Recurring income" value={formatCentsRounded(sum(income, "monthlyCents"))} hint="a month" />
      </div>

      {changes.length > 0 && (
        <Card className="mt-4" title="What changed">
          {list(changes, "")}
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card title={`Coming up in the next ${UPCOMING_DAYS} days`}>
          {soon.length === 0 ? (
            <p className="text-sm text-muted">Nothing expected.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {soon.map(({ item, date }) => (
                <li key={`${item.key}-${date}`} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.merchant}</span>
                    <span className="text-xs text-muted">
                      {date < today
                        ? `expected ${formatDay(date)} (a little late)`
                        : `${item.flexibleDay ? "around " : ""}${formatDay(date)}`}
                      {ownerOf(item) && ` · ${ownerOf(item)}`}
                    </span>
                  </span>
                  <span className={`shrink-0 tabular ${item.kind === "income" ? "text-accent" : ""}`}>
                    {item.kind === "income" ? "+" : ""}
                    {formatCents(item.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Subscriptions">
          {subscriptions.length === 0 ? (
            <p className="text-sm text-muted">No subscriptions found yet.</p>
          ) : (
            [...bySubcategory.entries()].map(([label, entries]) => (
              <div key={label} className="mb-2">
                <h3 className="flex justify-between text-xs font-semibold uppercase tracking-wide text-muted">
                  <span>{label}</span>
                  <span className="tabular">{formatCents(sum(entries, "monthlyCents"))}/mo</span>
                </h3>
                {list(entries, "")}
              </div>
            ))
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card title="Bills">{list(bills, "No recurring bills found yet.")}</Card>
        <Card title="Income">{list(income, "No recurring income found yet.")}</Card>
      </div>

      {(ended.length > 0 || hidden.length > 0) && (
        <details className="mt-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
          <summary className="cursor-pointer text-sm font-semibold">
            Ended or hidden ({ended.length + hidden.length})
          </summary>
          <p className="mt-2 text-xs text-muted">
            Charges that stopped arriving, ones you marked as stopped, and ones you said aren&apos;t recurring. They
            don&apos;t count in the totals above.
          </p>
          {list([...ended, ...hidden], "")}
        </details>
      )}

      <p className="mt-4 max-w-prose text-xs text-muted">
        Found automatically from your history: anything that arrives on a regular schedule with a steady amount.
        “Probably” means it has only been seen a couple of times or its amount varies. Totals are shown at today&apos;s
        prices, converted to a monthly or yearly amount.
      </p>
    </>
  );
}
