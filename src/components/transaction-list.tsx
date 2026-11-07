import Link from "next/link";
import type { Member } from "@/lib/data/types";
import { formatDay } from "@/lib/dates";
import type { AccountRow, CategoryRow, TransactionRow } from "@/lib/db/types";
import { TRANSACTION_TYPE_LABELS } from "@/lib/labels";
import { formatSignedAmount } from "@/lib/money";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/config";
import { todayInTimeZone } from "@/lib/dates";
import { PRIVATE_LABEL, isPrivateNow } from "@/lib/finance/privacy";

export interface Lookups {
  accounts: Map<string, AccountRow>;
  categories: Map<string, CategoryRow>;
  members: Map<string, Member>;
}

export function buildLookups(
  accounts: AccountRow[],
  categories: CategoryRow[],
  members: Member[],
): Lookups {
  return {
    accounts: new Map(accounts.map((account) => [account.id, account])),
    categories: new Map(categories.map((category) => [category.id, category])),
    members: new Map(members.map((member) => [member.id, member])),
  };
}

function categoryLabel(transaction: TransactionRow, lookups: Lookups): string | null {
  const category = transaction.category_id && lookups.categories.get(transaction.category_id);
  if (!category) return null;
  const subcategory = transaction.subcategory_id && lookups.categories.get(transaction.subcategory_id);
  return subcategory ? `${category.name} › ${subcategory.name}` : category.name;
}

function describe(transaction: TransactionRow, lookups: Lookups, today: string) {
  // Your own private purchases are masked in lists, in case the screen is shared.
  const hidden = isPrivateNow(transaction, today);
  const account = lookups.accounts.get(transaction.account_id);
  const person = transaction.person_id ? lookups.members.get(transaction.person_id) : null;
  const isSpending = transaction.transaction_type === "expense";
  return {
    merchant: hidden ? PRIVATE_LABEL : transaction.normalized_merchant,
    description: hidden ? "Only you can see this · open it for details" : transaction.original_description,
    category: hidden ? "Private" : categoryLabel(transaction, lookups),
    typeLabel: isSpending ? null : TRANSACTION_TYPE_LABELS[transaction.transaction_type],
    account: account ? `${account.institution} ${account.account_name}` : "",
    person: person?.name ?? "Shared",
    needsReview: transaction.review_status === "needs_review",
    manual: transaction.awaiting_post ? "Added by hand · waiting to post" : transaction.is_manual ? "Added by hand" : null,
    amountClass: transaction.amount > 0 ? "text-accent" : "",
  };
}

function Badge({ children, tone }: { children: string; tone: "notice" | "plain" }) {
  const colors = tone === "notice" ? "bg-notice-soft text-notice" : "bg-bg text-muted";
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${colors}`}>
      {children}
    </span>
  );
}

function CategoryCell({ info }: { info: ReturnType<typeof describe> }) {
  if (info.typeLabel && !info.category) return <Badge tone="plain">{info.typeLabel}</Badge>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {info.category ?? <span className="text-muted">Not yet categorized</span>}
      {info.typeLabel && <Badge tone="plain">{info.typeLabel}</Badge>}
    </span>
  );
}

export function TransactionList({
  transactions,
  lookups,
  empty = "No transactions here.",
}: {
  transactions: TransactionRow[];
  lookups: Lookups;
  empty?: string;
}) {
  if (transactions.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  const today = todayInTimeZone(HOUSEHOLD_TIME_ZONE);

  return (
    <>
      {/* Phone: stacked rows */}
      <ul className="divide-y divide-line md:hidden">
        {transactions.map((transaction) => {
          const info = describe(transaction, lookups, today);
          return (
            <li key={transaction.id} className="flex items-start justify-between gap-3 py-3">
              <Link href={`/transactions/${transaction.id}`} className="min-w-0">
                <p className="truncate text-sm font-medium">{info.merchant}</p>
                <div className="mt-0.5 text-xs text-muted">
                  <CategoryCell info={info} />
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {formatDay(transaction.transaction_date)} · {info.person}
                </p>
              </Link>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className={`text-sm font-medium tabular ${info.amountClass}`}>
                  {formatSignedAmount(transaction.amount)}
                </span>
                {info.needsReview && <Badge tone="notice">Needs review</Badge>}
                {info.manual && <Badge tone="plain">{info.manual}</Badge>}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Larger screens: table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Merchant</th>
              <th className="py-2 pr-4 font-medium">Category</th>
              <th className="py-2 pr-4 font-medium">Person</th>
              <th className="py-2 pr-4 font-medium">Account</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {transactions.map((transaction) => {
              const info = describe(transaction, lookups, today);
              return (
                <tr key={transaction.id} className="align-top">
                  <td className="whitespace-nowrap py-2.5 pr-4 text-muted tabular">
                    {formatDay(transaction.transaction_date)}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      <Link href={`/transactions/${transaction.id}`} className="hover:underline">
                        {info.merchant}
                      </Link>
                      {info.needsReview && <Badge tone="notice">Needs review</Badge>}
                      {info.manual && <Badge tone="plain">{info.manual}</Badge>}
                    </span>
                    <span className="block text-xs text-muted">{info.description}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <CategoryCell info={info} />
                  </td>
                  <td className="py-2.5 pr-4 text-muted">{info.person}</td>
                  <td className="py-2.5 pr-4 text-muted">{info.account}</td>
                  <td className={`whitespace-nowrap py-2.5 text-right font-medium tabular ${info.amountClass}`}>
                    {formatSignedAmount(transaction.amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
