import type { Metadata } from "next";
import { AddTransactionForm } from "@/components/manual/add-transaction-form";
import { Card, PageHeader, TextLink } from "@/components/ui";
import { categoryGroups } from "@/lib/categories/view";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/config";
import { getDataSource, requireHousehold } from "@/lib/data";
import { todayInTimeZone } from "@/lib/dates";
import { holdsTransactions } from "@/lib/finance/net-worth";
import { isCashAccount } from "@/lib/import/manual";

export const metadata: Metadata = { title: "Add a transaction" };

export default async function NewTransactionPage() {
  const session = await requireHousehold();
  const data = getDataSource();
  const [accounts, categories] = await Promise.all([
    data.listAccounts(session.household.id),
    data.listCategories(session.household.id),
  ]);
  const mine = accounts.filter((account) => account.owner_user_id === session.user.id && account.is_active);
  const options = accounts
    .filter((account) => account.is_active && holdsTransactions(account.account_type))
    .map((account) => ({
      id: account.id,
      label: `${account.institution} ${account.account_name}`,
      isCash: isCashAccount(account),
    }));
  // Default to the signer-in's own card, since that's what most quick entries are.
  const defaultAccount = mine.find((account) => account.account_type === "credit_card") ?? mine[0];

  return (
    <>
      <PageHeader
        title="Add a transaction"
        subtitle="For something that hasn't shown up in a bank download yet, or cash."
      >
        <TextLink href="/transactions">← All transactions</TextLink>
      </PageHeader>
      <Card className="max-w-2xl">
        {session.isDemo ? (
          <p className="text-sm text-muted">This is the demo with made-up data, so nothing can be saved here.</p>
        ) : (
          <AddTransactionForm
            accounts={options}
            defaultAccountId={defaultAccount?.id ?? ""}
            groups={categoryGroups(categories)}
            today={todayInTimeZone(HOUSEHOLD_TIME_ZONE)}
            hasCashAccount={accounts.some((account) => isCashAccount(account) && account.owner_user_id === session.user.id)}
          />
        )}
      </Card>
    </>
  );
}
