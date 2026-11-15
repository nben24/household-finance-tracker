// An in-memory, writable DataSource for testing server actions end to end
// without a database. It behaves like the real one where it matters for these
// tests: a fingerprint is unique per account, someone else's unrevealed
// private purchase is invisible (like Row Level Security), a hand-added entry
// is only replaced while it's still waiting, and any method can be made to
// fail on its Nth call.

import { randomUUID } from "node:crypto";
import { matchesFilter, sortTransactions } from "@/lib/data/demo";
import {
  SplitError,
  UndoError,
  type DataSource,
  type Member,
  type ReviewOperationInput,
  type SessionContext,
} from "@/lib/data/types";
import type {
  AccountCoverageRow,
  CategorizationRuleRow,
  ImportBatchRow,
  TransactionRow,
} from "@/lib/db/types";
import type { SeedData } from "@/lib/seed/generate";

export interface MemoryOperation extends ReviewOperationInput {
  id: string;
  user_id: string;
  undone: boolean;
}

export interface MemoryData extends DataSource {
  seed: SeedData;
  operations: MemoryOperation[];
  transactions: TransactionRow[];
  rules: CategorizationRuleRow[];
  coverage: AccountCoverageRow[];
  batches: ImportBatchRow[];
  /** who is signed in */
  as(userId: string): void;
  /** make `method` throw on its next `nth` call (1 = the next call) */
  failOn(method: string, nth?: number): void;
  calls: Record<string, number>;
}

export function memoryData(seed: SeedData, today: string): MemoryData {
  let userId = seed.members[0].user_id;
  const failures = new Map<string, number>();
  const calls: Record<string, number> = {};
  const transactions: TransactionRow[] = seed.transactions.map((row) => ({ ...row }));
  const rules: CategorizationRuleRow[] = seed.rules.map((rule) => ({ ...rule }));
  const coverage: AccountCoverageRow[] = seed.coverage.map((row) => ({ ...row }));
  const batches: ImportBatchRow[] = [];
  const operations: MemoryOperation[] = [];
  let clock = 0;
  const balances = seed.balances.map((row) => ({ ...row }));
  // Strictly increasing, like a database clock between separate requests.
  const now = () => new Date(Date.UTC(2026, 0, 1) + ++clock).toISOString();

  const visible = (row: TransactionRow) =>
    !row.is_private || row.person_id === userId || (row.private_until !== null && row.private_until <= today);

  function track(method: string) {
    calls[method] = (calls[method] ?? 0) + 1;
    const left = failures.get(method);
    if (left !== undefined) {
      if (left <= 1) {
        failures.delete(method);
        throw new Error(`Injected failure in ${method}`);
      }
      failures.set(method, left - 1);
    }
  }

  const source: MemoryData = {
    seed,
    operations,
    transactions,
    rules,
    coverage,
    batches,
    calls,
    as(id) {
      userId = id;
    },
    failOn(method, nth = 1) {
      failures.set(method, nth);
    },

    async getSession(): Promise<SessionContext> {
      const members: Member[] = seed.members.map((member, index) => ({
        id: member.user_id,
        email: `${index}@example.com`,
        name: index === 0 ? "John" : "Jane",
        role: member.role,
        created_at: member.created_at,
      }));
      return { user: { id: userId, email: "", name: "" }, household: seed.household, members, isDemo: false };
    },
    async listAccounts() {
      return seed.accounts;
    },
    async listCategories() {
      return seed.categories;
    },
    async listTransactions(_householdId, filter = {}, page) {
      track("listTransactions");
      const matching = sortTransactions(
        transactions.filter((row) => visible(row) && matchesFilter(row, filter)),
        page?.sort ?? "newest",
      );
      // Copies, like rows fetched from a database.
      const rows = (page ? matching.slice(page.offset, page.offset + page.limit) : matching).map((row) => ({ ...row }));
      return { rows, total: matching.length };
    },
    async createAccount() {
      throw new Error("not needed");
    },
    async listSourceHashes(_householdId, accountId, from, to) {
      // Like the database's index, fingerprints are checked whoever can see the row.
      return transactions
        .filter((t) => t.account_id === accountId && t.source_hash && t.transaction_date >= from && t.transaction_date <= to && visible(t))
        .map((t) => t.source_hash!);
    },
    async insertTransactions(rows) {
      track("insertTransactions");
      let added = 0;
      for (const row of rows) {
        if (row.source_hash && transactions.some((t) => t.account_id === row.account_id && t.source_hash === row.source_hash)) continue;
        if (row.is_private && row.person_id !== userId) throw new Error("row-level security");
        transactions.push({ ...row, id: randomUUID(), is_transfer: false, created_at: now(), updated_at: now() } as TransactionRow);
        added += 1;
      }
      return added;
    },
    async fillBankCategories() {},
    async getTransaction(_householdId, id) {
      const row = transactions.find((t) => t.id === id);
      return row && visible(row) ? row : null;
    },
    async transactionsByIds(_householdId, ids) {
      return transactions.filter((t) => ids.includes(t.id) && visible(t)).map((t) => ({ ...t }));
    },
    async recordReviewOperation(_householdId, operation) {
      track("recordReviewOperation");
      const id = randomUUID();
      operations.push({ ...structuredClone(operation), id, user_id: userId, undone: false });
      return id;
    },
    async undoReviewOperation(_householdId, id) {
      const op = operations.find((o) => o.id === id && o.user_id === userId && !o.undone);
      if (!op) throw new UndoError("gone");
      const conflict =
        op.transactions.some((item) => {
          const row = transactions.find((t) => t.id === item.id && visible(t));
          return !row || row.updated_at !== item.after;
        }) ||
        op.rules.some((item) => {
          const rule = rules.find((r) => r.match_type === item.match_type && r.pattern === item.pattern);
          return !rule || rule.updated_at !== item.after;
        });
      if (conflict) throw new UndoError("conflict");
      const stamp = now();
      for (const item of op.transactions) {
        const row = transactions.find((t) => t.id === item.id)!;
        Object.assign(row, item.before, { updated_at: stamp });
        if (item.splits && item.splits.length > 0) row.splits = item.splits;
      }
      for (const item of op.rules) {
        const index = rules.findIndex((r) => r.match_type === item.match_type && r.pattern === item.pattern);
        if (item.before === null) rules.splice(index, 1);
        else Object.assign(rules[index], item.before, { updated_at: stamp });
      }
      op.undone = true;
    },
    async saveSplits(householdId, transactionId, parts) {
      track("saveSplits");
      const parent = transactions.find((t) => t.id === transactionId && visible(t));
      if (!parent) throw new SplitError("not_found");
      if (parts.length === 0) {
        delete parent.splits;
        return;
      }
      if (parent.transaction_type !== "expense" && parent.transaction_type !== "refund") throw new SplitError("kind");
      if (parts.length < 2 || parts.length > 20) throw new SplitError("count");
      if (parts.some((part) => Math.sign(part.amount) !== Math.sign(parent.amount))) throw new SplitError("sign");
      const cents = parts.reduce((total, part) => total + Math.round(part.amount * 100), 0);
      if (cents !== Math.round(parent.amount * 100)) throw new SplitError("total");
      parent.splits = parts.map((part, position) => ({
        id: randomUUID(),
        household_id: householdId,
        transaction_id: parent.id,
        position,
        category_id: part.category_id,
        subcategory_id: part.subcategory_id,
        amount: part.amount,
        note: part.note ?? null,
        refund_of_split_id: part.refund_of_split_id ?? null,
        created_at: now(),
      }));
      const largest = [...parent.splits].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
      Object.assign(parent, {
        category_id: largest.category_id,
        subcategory_id: largest.subcategory_id,
        review_status: "reviewed",
        categorization_reason: `Split between ${parts.length} categories`,
        updated_at: now(),
      });
    },
    async updateTransactions(_householdId, ids, changes) {
      track("updateTransactions");
      let updated = 0;
      for (const row of transactions) {
        if (!ids.includes(row.id) || !visible(row)) continue;
        Object.assign(row, changes, { updated_at: now() });
        updated += 1;
      }
      return updated;
    },
    async listRules() {
      return rules;
    },
    async saveRule(_householdId, rule) {
      track("saveRule");
      const existing = rules.find((r) => r.match_type === rule.match_type && r.pattern === rule.pattern);
      if (existing) Object.assign(existing, rule, { updated_at: now() });
      else rules.push({ ...rule, id: randomUUID(), household_id: seed.household.id, created_at: now(), updated_at: now() });
    },
    async addMissingRules(_householdId, newRules) {
      for (const rule of newRules) {
        if (rules.some((r) => r.match_type === rule.match_type && r.pattern === rule.pattern)) continue;
        rules.push({ ...rule, id: randomUUID(), household_id: seed.household.id, created_at: now(), updated_at: now() });
      }
    },
    async updateRule(_householdId, id, changes) {
      const rule = rules.find((r) => r.id === id);
      if (rule) Object.assign(rule, changes, { updated_at: now() });
    },
    async deleteRule(_householdId, id) {
      const index = rules.findIndex((r) => r.id === id);
      if (index >= 0) rules.splice(index, 1);
    },
    async createCategory() {
      throw new Error("not needed");
    },
    async updateCategory() {},
    async listBudgetLines() {
      return seed.budgets;
    },
    async createBudgetLine() {},
    async changeBudgetLine() {},
    async endBudgetLine() {},
    async updateHouseholdSettings() {},
    async deleteTransaction(_householdId, id) {
      const index = transactions.findIndex((t) => t.id === id);
      if (index >= 0) transactions.splice(index, 1);
    },
    async replaceManualEntry(_householdId, id, row) {
      track("replaceManualEntry");
      const entry = transactions.find((t) => t.id === id && t.is_manual && t.awaiting_post && visible(t));
      if (!entry) return false;
      if (row.source_hash && transactions.some((t) => t.account_id === entry.account_id && t.source_hash === row.source_hash)) return false;
      Object.assign(entry, row, { updated_at: now() });
      return true;
    },
    async listRecurringOverrides() {
      return [];
    },
    async setRecurringOverride() {},
    async listBalances() {
      return balances;
    },
    async saveBalance() {},
    async recordImportedBalance() {},
    async deleteBalance() {},
    async updateAccount() {},
    async listIncomeSources() {
      return seed.incomeSources;
    },
    async saveIncomeSource() {},
    async deleteIncomeSource() {},
    async startImportBatch(householdId, batch) {
      track("startImportBatch");
      const existing = batches.find((b) => b.id === batch.id);
      if (existing) {
        if (existing.user_id !== userId) throw new Error("unknown batch");
        return { ...existing };
      }
      const row: ImportBatchRow = {
        id: batch.id,
        household_id: householdId,
        user_id: userId,
        status: "saving",
        file_count: batch.file_count,
        matched: 0,
        duplicates: 0,
        sort_problem: null,
        created_at: now(),
        updated_at: now(),
      };
      batches.push(row);
      return { ...row };
    },
    async getImportBatch(_householdId, id) {
      const batch = batches.find((b) => b.id === id && b.user_id === userId);
      return batch ? { ...batch } : null;
    },
    async updateImportBatch(_householdId, id, changes) {
      const batch = batches.find((b) => b.id === id && b.user_id === userId);
      if (batch) Object.assign(batch, changes, { updated_at: now() });
    },
    async unfinishedImport() {
      const mine = batches.filter((b) => b.user_id === userId);
      const last = mine[mine.length - 1];
      return last && last.status !== "sorted" ? { ...last } : null;
    },
    async getMonthClosing() {
      return null;
    },
    async saveMonthClosing() {},
    async listCoverage() {
      track("listCoverage");
      return coverage;
    },
    async recordCoverage(householdId, period) {
      coverage.push({ ...period, id: randomUUID(), household_id: householdId, recorded_by: userId, created_at: now() });
    },
  };
  return source;
}
