import type { Metadata } from "next";
import { ImportFlow } from "@/components/import/import-flow";
import { PageHeader } from "@/components/ui";
import { getDataSource, requireHousehold } from "@/lib/data";
import { holdsTransactions } from "@/lib/finance/net-worth";
import { SUPPORTED_INSTITUTIONS } from "@/lib/import/registry";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage() {
  const session = await requireHousehold();
  const accounts = (await getDataSource().listAccounts(session.household.id)).filter(
    (account) => account.is_active && holdsTransactions(account.account_type),
  );

  return (
    <>
      <PageHeader
        title="Import Transactions"
        subtitle={`Upload CSV files downloaded from ${SUPPORTED_INSTITUTIONS.join(", ")}.`}
      />
      <ImportFlow
        initialAccounts={accounts}
        people={session.members.map((member) => ({ id: member.id, name: member.name }))}
        currentUserId={session.user.id}
      />
      <p className="mt-4 max-w-prose text-xs text-muted">
        Your privacy: files are read on this device and never uploaded or kept. Only the date,
        description and amount of each transaction are saved. Account numbers, card numbers and
        other identifying details are discarded, and you will never be asked for a bank login.
      </p>
    </>
  );
}
