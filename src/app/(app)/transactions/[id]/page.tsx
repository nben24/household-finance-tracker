import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ManualEntryActions } from "@/components/manual/manual-entry-actions";
import { PrivacyControl } from "@/components/manual/privacy-control";
import { TransactionEditor } from "@/components/review/transaction-editor";
import { PageHeader, TextLink } from "@/components/ui";
import { categoryGroups, frequentSubcategories, toReviewItem } from "@/lib/categories/view";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/config";
import { getDataSource, requireHousehold } from "@/lib/data";
import { addDays, todayInTimeZone } from "@/lib/dates";
import { canKeepPrivate } from "@/lib/finance/privacy";
import { isUuid } from "@/lib/params";

export const metadata: Metadata = { title: "Transaction" };

export default async function TransactionPage({ params }: PageProps<"/transactions/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const session = await requireHousehold();
  const householdId = session.household.id;
  const data = getDataSource();

  const [transaction, accounts, categories, rules, recent] = await Promise.all([
    data.getTransaction(householdId, id),
    data.listAccounts(householdId),
    data.listCategories(householdId),
    data.listRules(householdId),
    data.listTransactions(householdId, { from: addDays(todayInTimeZone(HOUSEHOLD_TIME_ZONE), -90) }),
  ]);
  if (!transaction) notFound();

  const sameMerchant = transaction.is_private
    ? 0
    : (await data.listTransactions(householdId, { search: transaction.normalized_merchant })).rows.filter(
        (row) => row.id !== transaction.id && row.normalized_merchant === transaction.normalized_merchant && !row.is_private,
      ).length;
  const baseItem = toReviewItem(
    transaction,
    new Map(accounts.map((account) => [account.id, account])),
    new Map(session.members.map((member) => [member.id, member])),
    rules,
  );
  const item = { ...baseItem, sameMerchantCount: sameMerchant };

  return (
    <>
      <PageHeader title="Transaction">
        <TextLink href="/transactions">← All transactions</TextLink>
      </PageHeader>
      <TransactionEditor
        item={item}
        groups={categoryGroups(categories, [transaction.subcategory_id])}
        quickPicks={frequentSubcategories(recent.rows)}
      />
      {transaction.is_manual && !session.isDemo && (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4">
          <p className="mb-2 text-sm">
            {transaction.awaiting_post
              ? "You added this by hand. When the bank's version shows up in an import, it will replace this entry."
              : "You added this by hand."}
          </p>
          <ManualEntryActions id={transaction.id} awaitingPost={transaction.awaiting_post} afterDelete="/transactions" />
        </div>
      )}
      {!session.isDemo && canKeepPrivate(transaction, session.user.id) && (
        <PrivacyControl
          id={transaction.id}
          isPrivate={transaction.is_private}
          until={transaction.private_until}
          otherName={session.members.find((member) => member.id !== session.user.id)?.name ?? "The other person"}
          today={todayInTimeZone(HOUSEHOLD_TIME_ZONE)}
        />
      )}
      {transaction.categorization_reason && (
        <p className="mt-3 text-xs text-muted">How it was sorted: {transaction.categorization_reason}</p>
      )}
    </>
  );
}
