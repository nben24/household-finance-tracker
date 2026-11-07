import { monthKey } from "@/lib/dates";
import type { CategoryRow, TransactionRow } from "@/lib/db/types";
import { toCents } from "@/lib/money";

type SummaryTransaction = Pick<
  TransactionRow,
  | "amount"
  | "transaction_type"
  | "category_id"
  | "person_id"
  | "counterparty_id"
  | "review_status"
  | "transaction_date"
>;

/**
 * Only expenses and refunds count toward spending. Transfers, credit card
 * payments and investment moves shift money between accounts and are ignored,
 * which is what prevents double counting a card payment.
 */
export function countsAsSpending(transaction: Pick<TransactionRow, "transaction_type">): boolean {
  return transaction.transaction_type === "expense" || transaction.transaction_type === "refund";
}

/** Spending as a positive number of cents; a refund (positive amount) reduces it. */
export function spendingCents(transactions: SummaryTransaction[]): number {
  return transactions
    .filter(countsAsSpending)
    .reduce((total, transaction) => total - toCents(transaction.amount), 0);
}

export function incomeCents(transactions: SummaryTransaction[]): number {
  return transactions
    .filter((transaction) => transaction.transaction_type === "income")
    .reduce((total, transaction) => total + toCents(transaction.amount), 0);
}

export interface PeriodSummary {
  incomeCents: number;
  spendingCents: number;
  /** income − spending */
  netCents: number;
  transactionCount: number;
  needsReviewCount: number;
}

export function summarize(transactions: SummaryTransaction[]): PeriodSummary {
  const income = incomeCents(transactions);
  const spending = spendingCents(transactions);
  return {
    incomeCents: income,
    spendingCents: spending,
    netCents: income - spending,
    transactionCount: transactions.length,
    needsReviewCount: transactions.filter((t) => t.review_status === "needs_review").length,
  };
}

export interface GroupTotal {
  /** null = no category / shared household */
  id: string | null;
  name: string;
  cents: number;
  count: number;
}

function groupSpending(
  transactions: SummaryTransaction[],
  keyOf: (transaction: SummaryTransaction) => string | null,
  nameOf: (id: string | null) => string,
): GroupTotal[] {
  const groups = new Map<string | null, GroupTotal>();
  for (const transaction of transactions.filter(countsAsSpending)) {
    const id = keyOf(transaction);
    const group = groups.get(id) ?? { id, name: nameOf(id), cents: 0, count: 0 };
    group.cents -= toCents(transaction.amount);
    group.count += 1;
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
}

export function spendingByCategory(
  transactions: SummaryTransaction[],
  categories: Pick<CategoryRow, "id" | "name">[],
): GroupTotal[] {
  const names = new Map(categories.map((category) => [category.id, category.name]));
  return groupSpending(
    transactions,
    (transaction) => transaction.category_id,
    (id) => (id ? (names.get(id) ?? "Unknown") : "Not yet categorized"),
  );
}

/**
 * Personal spending. Each purchase belongs to whoever paid; a payback between
 * members then moves that amount from the person who received it to the
 * person who sent it. Only the receiving side's row is used, so a payback seen
 * in both people's accounts is counted once. The total always equals household
 * spending.
 */
export function spendingByPerson(
  transactions: SummaryTransaction[],
  people: { id: string; name: string }[],
): GroupTotal[] {
  const names = new Map(people.map((person) => [person.id, person.name]));
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "Unknown") : "Shared");
  const groups = new Map(
    groupSpending(transactions, (transaction) => transaction.person_id, nameOf).map((group) => [group.id, group]),
  );
  const groupFor = (id: string) => {
    const group = groups.get(id) ?? { id, name: nameOf(id), cents: 0, count: 0 };
    groups.set(id, group);
    return group;
  };

  for (const payback of transactions) {
    if (
      payback.transaction_type !== "reimbursement" ||
      payback.amount <= 0 ||
      !payback.person_id ||
      !payback.counterparty_id
    ) {
      continue;
    }
    const cents = toCents(payback.amount);
    groupFor(payback.person_id).cents -= cents;
    groupFor(payback.counterparty_id).cents += cents;
  }

  return [...groups.values()]
    .filter((group) => group.cents !== 0 || group.count > 0)
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
}

/** Spending per month for each requested 'YYYY-MM', in the order given. */
export function spendingByMonth(
  transactions: SummaryTransaction[],
  months: string[],
): { month: string; cents: number }[] {
  return months.map((month) => ({
    month,
    cents: spendingCents(transactions.filter((t) => monthKey(t.transaction_date) === month)),
  }));
}

/** Spending filed under the top-level "Other" category. */
export function otherSpending(
  transactions: SummaryTransaction[],
  categories: Pick<CategoryRow, "id" | "name" | "parent_id">[],
): { categoryId: string | null; cents: number; count: number } {
  const other = categories.find((category) => category.parent_id === null && category.name.toLowerCase() === "other");
  if (!other) return { categoryId: null, cents: 0, count: 0 };
  const rows = transactions.filter((t) => countsAsSpending(t) && t.category_id === other.id);
  return { categoryId: other.id, cents: spendingCents(rows), count: rows.length };
}
