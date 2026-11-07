import { HOUSEHOLD_TIME_ZONE } from "@/lib/config";
import { todayInTimeZone } from "@/lib/dates";
import type { TransactionRow } from "@/lib/db/types";
import { generateSeedData, type SeedData } from "@/lib/seed/generate";
import type { DataSource, Member, TransactionFilter, TransactionSort } from "./types";

const JOHN_ID = "00000000-0000-4000-8000-000000000001";
const JANE_ID = "00000000-0000-4000-8000-000000000002";

export const DEMO_READ_ONLY = "Demo mode is read-only";

async function readOnly(): Promise<never> {
  throw new Error(DEMO_READ_ONLY);
}

let cached: { date: string; data: SeedData } | null = null;

function demoData(): SeedData {
  const today = todayInTimeZone(HOUSEHOLD_TIME_ZONE);
  if (cached?.date !== today) {
    cached = {
      date: today,
      data: generateSeedData({ endDate: today, johnId: JOHN_ID, janeId: JANE_ID, months: 12 }),
    };
  }
  return cached.data;
}

/** Same order as the database query: the chosen order, then newest first, then id. */
export function sortTransactions(rows: TransactionRow[], sort: TransactionSort): TransactionRow[] {
  const byAmount = sort === "largest_out" ? 1 : sort === "largest_in" ? -1 : 0;
  const byDate = sort === "oldest" ? 1 : -1;
  return [...rows].sort(
    (a, b) =>
      byAmount * (a.amount - b.amount) ||
      byDate * a.transaction_date.localeCompare(b.transaction_date) ||
      a.id.localeCompare(b.id),
  );
}

export function matchesFilter(transaction: TransactionRow, filter: TransactionFilter): boolean {
  if (filter.from && transaction.transaction_date < filter.from) return false;
  if (filter.to && transaction.transaction_date > filter.to) return false;
  if (filter.accountId && transaction.account_id !== filter.accountId) return false;
  if (filter.categoryId && transaction.category_id !== filter.categoryId) return false;
  if (filter.personId === "household" && transaction.person_id !== null) return false;
  if (filter.personId && filter.personId !== "household" && transaction.person_id !== filter.personId) {
    return false;
  }
  if (filter.needsReview && transaction.review_status !== "needs_review") return false;
  if (filter.awaitingPost && !transaction.awaiting_post) return false;
  if (filter.search) {
    const needle = filter.search.toLowerCase();
    const haystack = `${transaction.normalized_merchant} ${transaction.original_description}`;
    if (!haystack.toLowerCase().includes(needle)) return false;
  }
  return true;
}

export const demoDataSource: DataSource = {
  async getSession() {
    const { household, members } = demoData();
    const createdAt = household.created_at;
    const people: Member[] = [
      { id: JOHN_ID, email: "john@example.com", name: "John", role: "owner", created_at: createdAt },
      { id: JANE_ID, email: "jane@example.com", name: "Jane", role: "member", created_at: createdAt },
    ].filter((person) => members.some((member) => member.user_id === person.id)) as Member[];
    return {
      user: { id: JOHN_ID, email: "john@example.com", name: "John" },
      household,
      members: people,
      isDemo: true,
    };
  },

  async listAccounts() {
    return demoData().accounts;
  },

  async listCategories() {
    return demoData().categories;
  },

  async listTransactions(_householdId, filter = {}, page) {
    const matching = sortTransactions(
      demoData().transactions.filter((t) => matchesFilter(t, filter)),
      page?.sort ?? "newest",
    );
    const rows = page ? matching.slice(page.offset, page.offset + page.limit) : matching;
    return { rows, total: matching.length };
  },

  createAccount: readOnly,

  async listSourceHashes(_householdId, accountId, from, to) {
    return demoData()
      .transactions.filter(
        (t) =>
          t.account_id === accountId &&
          t.source_hash !== null &&
          t.transaction_date >= from &&
          t.transaction_date <= to,
      )
      .map((t) => t.source_hash as string);
  },

  insertTransactions: readOnly,
  fillBankCategories: readOnly,

  async getTransaction(_householdId, id) {
    return demoData().transactions.find((t) => t.id === id) ?? null;
  },

  async listRules() {
    return demoData().rules;
  },

  updateTransactions: readOnly,
  saveRule: readOnly,
  addMissingRules: readOnly,
  updateRule: readOnly,
  deleteRule: readOnly,
  createCategory: readOnly,
  updateCategory: readOnly,

  async listBudgetLines() {
    return demoData().budgets;
  },

  createBudgetLine: readOnly,
  updateBudgetLine: readOnly,
  deleteBudgetLine: readOnly,

  updateHouseholdSettings: readOnly,

  deleteTransaction: readOnly,
  replaceManualEntry: readOnly,

  async listRecurringOverrides() {
    return [];
  },

  setRecurringOverride: readOnly,

  async listBalances() {
    return demoData().balances;
  },

  saveBalance: readOnly,
  recordImportedBalance: readOnly,
  deleteBalance: readOnly,
  updateAccount: readOnly,

  async listIncomeSources() {
    return demoData().incomeSources;
  },

  saveIncomeSource: readOnly,
  deleteIncomeSource: readOnly,
};
