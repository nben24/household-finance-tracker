import type { Metadata } from "next";
import { unfinishedImportSummary } from "@/app/(app)/import/actions";
import { CoverageCard } from "@/components/coverage-card";
import { ImportFlow } from "@/components/import/import-flow";
import { PageHeader } from "@/components/ui";
import { getDataSource, requireHousehold } from "@/lib/data";
import { holdsTransactions } from "@/lib/finance/net-worth";
import { householdToday } from "@/lib/household-time";
import { SUPPORTED_INSTITUTIONS } from "@/lib/import/registry";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage() {
  const session = await requireHousehold();
  const [allAccounts, unfinished] = await Promise.all([
    getDataSource().listAccounts(session.household.id),
    session.isDemo ? Promise.resolve(null) : unfinishedImportSummary(),
  ]);
  const accounts = allAccounts.filter((account) => account.is_active && holdsTransactions(account.account_type));

  return (
    <>
      <PageHeader
        title="Import transactions"
        subtitle={`Upload CSV or Excel files downloaded from ${SUPPORTED_INSTITUTIONS.join(", ")}.`}
      />
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-start">
        <ImportFlow
          initialAccounts={accounts}
          people={session.members.map((member) => ({ id: member.id, name: member.name }))}
          currentUserId={session.user.id}
          today={householdToday(session.household)}
          unfinished={unfinished}
        />
        <CoverageCard householdId={session.household.id} />
      </div>
      <p className="mt-4 max-w-prose text-[13px] text-muted">
        Your privacy: files are read on this device and never uploaded or kept. Only the date, description and amount
        of each transaction are saved. Account numbers, card numbers and other identifying details are discarded, and
        you will never be asked for a bank login.
      </p>
    </>
  );
}
