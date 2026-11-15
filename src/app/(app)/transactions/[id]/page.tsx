import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ManualEntryActions } from "@/components/manual/manual-entry-actions";
import { PrivacyControl } from "@/components/manual/privacy-control";
import { RefundLink, SplitEditor, type RefundCandidate, type SplitPartView } from "@/components/review/split-editor";
import { TransactionEditor } from "@/components/review/transaction-editor";
import { PageHeader, TextLink } from "@/components/ui";
import { categoryGroups, frequentSubcategories, toReviewItem } from "@/lib/categories/view";
import { getDataSource, requireHousehold } from "@/lib/data";
import { addDays } from "@/lib/dates";
import { isSplit } from "@/lib/finance/allocations";
import { canKeepPrivate } from "@/lib/finance/privacy";
import type { CategoryRow, TransactionRow } from "@/lib/db/types";
import { toCents } from "@/lib/money";
import { isUuid } from "@/lib/params";
import { householdToday } from "@/lib/household-time";

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
    data.listTransactions(householdId, { from: addDays(householdToday(session.household), -90) }),
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
  const groups = categoryGroups(categories, [transaction.subcategory_id]);
  const partsOf = (row: TransactionRow): SplitPartView[] =>
    isSplit(row)
      ? row.splits!.map((part) => ({
          id: part.id,
          subcategoryId: part.subcategory_id,
          label: partLabel(categories, part.category_id, part.subcategory_id),
          cents: Math.abs(toCents(part.amount)),
          note: part.note,
        }))
      : [];
  const splittable = transaction.transaction_type === "expense" || transaction.transaction_type === "refund";

  // For a refund: purchases it might refund (same merchant, in the six months before it).
  let refundCandidates: RefundCandidate[] = [];
  if (transaction.transaction_type === "refund") {
    const { rows } = await data.listTransactions(householdId, {
      search: transaction.normalized_merchant,
      from: addDays(transaction.transaction_date, -180),
      to: transaction.transaction_date,
    });
    const purchases = rows.filter((row) => row.transaction_type === "expense" && row.normalized_merchant === transaction.normalized_merchant);
    if (transaction.refund_of && !purchases.some((row) => row.id === transaction.refund_of)) {
      const linked = await data.getTransaction(householdId, transaction.refund_of);
      if (linked) purchases.unshift(linked);
    }
    refundCandidates = purchases.slice(0, 30).map((row) => ({
      id: row.id,
      date: row.transaction_date,
      merchant: row.normalized_merchant,
      cents: Math.abs(toCents(row.amount)),
      parts: partsOf(row),
    }));
  }

  return (
    <>
      <PageHeader title="Transaction">
        <TextLink href="/transactions">← All transactions</TextLink>
      </PageHeader>
      <TransactionEditor item={item} groups={groups} quickPicks={frequentSubcategories(recent.rows)} split={isSplit(transaction)} />
      {splittable && (
        <SplitEditor
          transactionId={transaction.id}
          amountCents={Math.abs(toCents(transaction.amount))}
          groups={groups}
          parts={partsOf(transaction)}
          defaultSubcategoryId={transaction.subcategory_id}
          readOnly={session.isDemo}
        />
      )}
      {transaction.transaction_type === "refund" && (
        <RefundLink
          refundId={transaction.id}
          refundCents={Math.abs(toCents(transaction.amount))}
          linkedId={transaction.refund_of ?? null}
          candidates={refundCandidates}
          readOnly={session.isDemo}
        />
      )}
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
          today={householdToday(session.household)}
        />
      )}
      {transaction.categorization_reason && (
        <p className="mt-3 text-xs text-muted">How it was sorted: {transaction.categorization_reason}</p>
      )}
    </>
  );
}

function partLabel(categories: CategoryRow[], categoryId: string, subcategoryId: string | null): string {
  const name = (id: string | null) => categories.find((category) => category.id === id)?.name ?? "";
  return subcategoryId ? `${name(categoryId)} › ${name(subcategoryId)}` : name(categoryId);
}
