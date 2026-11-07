import type { Metadata } from "next";
import Link from "next/link";
import { AiButton, MerchantCard, ReviewStartForm } from "@/components/catch-up/catch-up-controls";
import { Card, Metric, PageHeader } from "@/components/ui";
import { AI_MODEL, isAiConfigured } from "@/lib/ai/categorize-merchants";
import { merchantsToAsk } from "@/lib/categories/ai-sort";
import { SORT_SOURCE_LABELS, groupByMerchant, sortSources, spotCheckSample, type SortSource } from "@/lib/categories/catch-up";
import { alwaysByDefault, findRule } from "@/lib/categories/rules";
import { categoryGroups } from "@/lib/categories/view";
import { HOUSEHOLD_TIME_ZONE, WEEK_STARTS_ON } from "@/lib/config";
import { catchUpFilter, getDataSource, requireHousehold } from "@/lib/data";
import { addDays, formatDay, formatDayWithYear, todayInTimeZone, weekRange } from "@/lib/dates";
import { PRIVATE_LABEL, isPrivateNow } from "@/lib/finance/privacy";
import { formatSignedAmount } from "@/lib/money";

export const metadata: Metadata = { title: "Catch-up" };

const GROUP_LIMIT = 40;
const SAMPLE_SIZE = 15;

export default async function CatchUpPage() {
  const session = await requireHousehold();
  const householdId = session.household.id;
  const data = getDataSource();
  const today = todayInTimeZone(HOUSEHOLD_TIME_ZONE);
  const start = session.household.review_starts_on;
  const suggestedStart = weekRange(today, WEEK_STARTS_ON).from;

  const intro = (
    <PageHeader
      title="Catch-up"
      subtitle="Sort past transactions in bulk, so Sunday Review only covers the weeks you meet about."
    />
  );

  if (!start) {
    return (
      <>
        {intro}
        <Card>
          <p className="max-w-prose text-sm">
            Pick the date your weekly reviews start. Transactions before it are treated as history: anything the app
            can sort, it sorts without asking, and the rest is grouped here by merchant so one choice covers them all.
          </p>
          <div className="mt-4">
            <ReviewStartForm current={null} suggested={suggestedStart} />
          </div>
        </Card>
      </>
    );
  }

  const filter = catchUpFilter(session.household)!;
  const [waiting, history, categories, rules] = await Promise.all([
    data.listTransactions(householdId, filter),
    data.listTransactions(householdId, { to: addDays(start, -1) }),
    data.listCategories(householdId),
    data.listRules(householdId),
  ]);
  const groups = groupByMerchant(waiting.rows);
  const merchantRules = rules.filter((rule) => rule.match_type === "merchant");
  const unknownForAi = merchantsToAsk(waiting.rows, new Set(merchantRules.map((rule) => rule.pattern))).length;
  const sources = sortSources(history.rows);
  const sorted = Object.values(sources).reduce((a, b) => a + b, 0);
  const sample = spotCheckSample(
    history.rows.filter((row) => row.category_id && row.categorization_reason && !row.categorization_reason.startsWith("Chosen")),
    SAMPLE_SIZE,
  );
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const pickers = categoryGroups(categories);

  return (
    <>
      {intro}

      <Card>
        <ReviewStartForm current={start} suggested={suggestedStart} />
        <p className="mt-2 text-xs text-muted">
          Everything before {formatDayWithYear(start)} is history. Sunday Review covers {formatDay(start)} onward.
        </p>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="History" value={history.total.toLocaleString("en-US")} hint="transactions before the start date" />
        <Metric label="Sorted" value={sorted.toLocaleString("en-US")} hint="purchases with a category" />
        <Metric label="Waiting" value={waiting.total.toLocaleString("en-US")} hint="still need a decision" />
        <Metric label="Merchants" value={String(groups.length)} hint="one decision each" />
      </div>

      {waiting.total > 0 && (
        <Card className="mt-4" title="Let AI sort the unfamiliar ones">
          {isAiConfigured() ? (
            <>
              <p className="mb-3 max-w-prose text-sm text-muted">
                Sends only merchant names and the bank&apos;s category label to {AI_MODEL} — never amounts, dates,
                accounts or people&apos;s names. Each merchant is asked about once and saved as a rule you can change in
                Settings → Sorting rules.
              </p>
              <AiButton merchants={unknownForAi} />
            </>
          ) : (
            <p className="text-sm text-muted">
              AI sorting isn&apos;t set up. Add <code>ANTHROPIC_API_KEY</code> to the app&apos;s settings to turn it on.
            </p>
          )}
        </Card>
      )}

      {groups.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold">
            Waiting, by merchant
            {groups.length > GROUP_LIMIT && (
              <span className="ml-2 font-normal text-muted">
                showing the {GROUP_LIMIT} biggest of {groups.length}
              </span>
            )}
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {groups.slice(0, GROUP_LIMIT).map((group) => (
              <MerchantCard
                key={group.merchant}
                group={group}
                groups={pickers}
                alwaysDefault={alwaysByDefault(
                  group.merchant,
                  findRule(merchantRules, {
                    normalized_merchant: group.merchant,
                    original_description: "",
                    bank_category: null,
                    transaction_type: "expense",
                  }),
                )}
              />
            ))}
          </div>
        </section>
      ) : (
        <Card className="mt-4">
          <p className="text-lg font-semibold">✓ History is all sorted</p>
        </Card>
      )}

      {sorted > 0 && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="How history was sorted">
            <ul className="flex flex-col gap-2 text-sm">
              {(Object.keys(SORT_SOURCE_LABELS) as SortSource[]).map((source) => (
                <li key={source} className="flex justify-between gap-3">
                  <span>{SORT_SOURCE_LABELS[source]}</span>
                  <span className="tabular text-muted">
                    {sources[source]} ({Math.round((sources[source] / sorted) * 100)}%)
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Spot-check">
            <p className="mb-3 text-xs text-muted">
              A sample of purchases the app sorted on its own. If one is wrong, open it, fix it, and tick “Also change
              the other transactions from …” to fix that merchant everywhere.
            </p>
            <ul className="divide-y divide-line text-sm">
              {sample.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/transactions/${row.id}`} className="min-w-0 hover:underline">
                    <span className="block truncate font-medium">
                      {isPrivateNow(row, today) ? PRIVATE_LABEL : row.normalized_merchant}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {names.get(row.category_id ?? "")} › {names.get(row.subcategory_id ?? "")} ·{" "}
                      {row.categorization_reason}
                    </span>
                  </Link>
                  <span className="shrink-0 tabular">{formatSignedAmount(row.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
