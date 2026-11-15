import Link from "next/link";
import { Card } from "@/components/ui";
import { formatDay, formatDayWithYear } from "@/lib/dates";
import { importableAccounts } from "@/lib/finance/coverage";
import { loadCoverage } from "@/lib/finance/load-coverage";
import { CoverageConfirm } from "./coverage-confirm";

/** "3 of 4 accounts updated through November 13", and what to do about the rest. */
export function coverageHeadline(summary: { latest: string | null; upToDate: number; total: number }): string {
  if (!summary.latest || summary.total === 0) return "No account activity imported yet";
  if (summary.upToDate === summary.total) {
    return `${summary.total === 1 ? "Your account is" : `All ${summary.total} accounts are`} updated through ${formatDay(summary.latest)}`;
  }
  return `${summary.upToDate} of ${summary.total} accounts updated through ${formatDay(summary.latest)}`;
}

/**
 * Where each account's imported activity ends. Shows only account names and
 * dates (never transactions), so nothing about a private purchase shows.
 */
export async function CoverageCard({
  householdId,
  readOnly = false,
  title = "What's been imported",
}: {
  householdId: string;
  readOnly?: boolean;
  title?: string;
}) {
  const coverage = await loadCoverage(householdId);
  const { summary } = coverage;
  const names = new Map(
    importableAccounts(coverage.accounts).map((account) => [account.id, `${account.institution} ${account.account_name}`]),
  );
  const behind = summary.accounts.filter((status) => status.through !== summary.latest);

  return (
    <Card title={title}>
      <p className="text-sm font-medium">{coverageHeadline(summary)}</p>
      {summary.accounts.length > 0 && (
        <ul className="mt-3 divide-y divide-line text-sm">
          {summary.accounts.map((status) => (
            <li key={status.accountId} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 break-anywhere">{names.get(status.accountId)}</span>
              <span className={`text-right text-[13px] ${status.through && status.through === summary.latest ? "text-muted" : "text-notice"}`}>
                {status.through ? (
                  <>
                    through {formatDayWithYear(status.through)}
                    {status.estimated && <span className="block text-muted">estimated from earlier imports</span>}
                  </>
                ) : (
                  "not imported yet"
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {behind.length > 0 && (
        <div className="mt-3 border-t border-line pt-3 text-[13px] text-muted">
          <p>
            Months are only used for averages and forecasts once every account&apos;s activity covers them.{" "}
            <Link href="/import" className="font-medium text-accent hover:underline">
              Import the missing activity
            </Link>
            {readOnly ? "." : ", or confirm an account had nothing new:"}
          </p>
          {!readOnly && (
            <CoverageConfirm
              accounts={behind.map((status) => ({ id: status.accountId, name: names.get(status.accountId) ?? "" }))}
              latest={summary.latest}
            />
          )}
        </div>
      )}
    </Card>
  );
}
