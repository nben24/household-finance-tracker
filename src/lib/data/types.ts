import type { NewTransaction } from "@/lib/import/prepare";
import type { TransactionInsert } from "@/lib/db/types";
import type {
  MonthClosingRow,
  SplitRow,
  AccountCoverageRow,
  ImportBatchRow,
  IncomeSourceRow,
  AccountBalanceRow,
  AccountRow,
  AccountType,
  BudgetLineRow,
  RecurringOverrideRow,
  RecurringStatus,
  CategorizationRuleRow,
  ExpenseType,
  RuleMatchType,
  RuleSource,
  TransactionType,
  CategoryRow,
  HouseholdRole,
  HouseholdRow,
  ProfileRow,
  TransactionRow,
} from "@/lib/db/types";

export interface Member extends ProfileRow {
  role: HouseholdRole;
}

export interface SessionContext {
  user: { id: string; email: string; name: string };
  /** null when the signed-in person has not been added to a household yet */
  household: HouseholdRow | null;
  members: Member[];
  isDemo: boolean;
}

export interface TransactionFilter {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  /** a member's id, or "household" for shared (no person) */
  personId?: string;
  needsReview?: boolean;
  /** only hand-added entries still waiting to show up in a bank download */
  awaitingPost?: boolean;
  /** only rows saved or matched by this import */
  importBatchId?: string;
  search?: string;
}

/**
 * Order for a page of transactions. Amounts are signed (money out is
 * negative), so "biggest money out" is the most negative first.
 */
export const TRANSACTION_SORTS = ["newest", "oldest", "largest_out", "largest_in"] as const;
export type TransactionSort = (typeof TRANSACTION_SORTS)[number];

export interface Page {
  limit: number;
  offset: number;
  /** default: newest */
  sort?: TransactionSort;
}

export interface NewAccount {
  institution: string;
  account_name: string;
  account_type: AccountType;
  owner_user_id: string | null;
  last_four: string | null;
}

export interface RuleInput {
  match_type: RuleMatchType;
  pattern: string;
  category_id: string;
  subcategory_id: string;
  auto_apply: boolean;
  source: RuleSource;
}

/** Fields a person can change on a transaction. */
export interface TransactionChanges {
  transaction_type?: TransactionType;
  counterparty_id?: string | null;
  normalized_merchant?: string;
  category_id?: string | null;
  subcategory_id?: string | null;
  expense_type?: ExpenseType | null;
  review_status?: TransactionRow["review_status"];
  categorization_confidence?: TransactionRow["categorization_confidence"];
  categorization_reason?: string | null;
  notes?: string | null;
  awaiting_post?: boolean;
  is_private?: boolean;
  private_until?: string | null;
  refund_of?: string | null;
}

export interface CategoryInput {
  parent_id: string | null;
  name: string;
  default_expense_type: ExpenseType | null;
  sort_order: number;
}

export type NewBudgetLine = Omit<BudgetLineRow, "id" | "household_id" | "created_at">;

/** Fields a review decision can change, as they were before it. */
export type ReviewSnapshot = Pick<
  TransactionRow,
  | "transaction_type"
  | "counterparty_id"
  | "category_id"
  | "subcategory_id"
  | "expense_type"
  | "review_status"
  | "categorization_confidence"
  | "categorization_reason"
  | "notes"
>;

export interface ReviewOperationInput {
  summary: string;
  transactions: { id: string; before: ReviewSnapshot; splits: SplitRow[] | null; after: string }[];
  rules: {
    match_type: CategorizationRuleRow["match_type"];
    pattern: string;
    before: Pick<CategorizationRuleRow, "category_id" | "subcategory_id" | "auto_apply" | "source"> | null;
    after: string;
  }[];
}

/** Why an undo was refused (see undo_review_operation). */
export class UndoError extends Error {
  constructor(public readonly reason: "gone" | "conflict") {
    super(`undo_${reason}`);
  }
}

/** Why a split was refused (see save_transaction_splits). */
export class SplitError extends Error {
  constructor(public readonly reason: "not_found" | "kind" | "count" | "sign" | "total") {
    super(`split_${reason}`);
  }
}

export interface SplitPart {
  category_id: string;
  subcategory_id: string | null;
  /** same sign as the transaction */
  amount: number;
  note?: string | null;
  refund_of_split_id?: string | null;
}

/** Why a budget change was refused. */
export class BudgetError extends Error {
  constructor(public readonly reason: "conflict" | "stale" | "not_found") {
    super(`budget_${reason}`);
  }
}

export interface DataSource {
  getSession(): Promise<SessionContext | null>;
  listAccounts(householdId: string): Promise<AccountRow[]>;
  listCategories(householdId: string): Promise<CategoryRow[]>;
  /** Newest first unless the page says otherwise. Without a page, returns every matching row. */
  listTransactions(
    householdId: string,
    filter?: TransactionFilter,
    page?: Page,
  ): Promise<{ rows: TransactionRow[]; total: number }>;

  createAccount(householdId: string, account: NewAccount): Promise<AccountRow>;
  /** Fingerprints already saved for an account within a date range. */
  listSourceHashes(householdId: string, accountId: string, from: string, to: string): Promise<string[]>;
  /** Saves rows, silently skipping any whose fingerprint already exists. Returns how many were added. */
  insertTransactions(rows: Omit<TransactionInsert, "id" | "created_at" | "updated_at">[]): Promise<number>;
  /** Fills in the bank's category on already-saved rows that don't have one. */
  fillBankCategories(householdId: string, rows: Pick<NewTransaction, "account_id" | "source_hash" | "bank_category">[]): Promise<void>;

  getTransaction(householdId: string, id: string): Promise<TransactionRow | null>;
  /** The given transactions (those visible to you), in no particular order. */
  transactionsByIds(householdId: string, ids: string[]): Promise<TransactionRow[]>;
  /** Records a review decision so it can be undone; returns its id. */
  recordReviewOperation(householdId: string, operation: ReviewOperationInput): Promise<string>;
  /** Undoes a recorded decision in one step; UndoError if it's gone or something changed since. */
  undoReviewOperation(householdId: string, id: string): Promise<void>;
  /**
   * Replaces a transaction's split in one step (an empty list removes it).
   * The parts must add up to its amount exactly; SplitError otherwise.
   */
  saveSplits(householdId: string, transactionId: string, parts: SplitPart[]): Promise<void>;
  updateTransactions(householdId: string, ids: string[], changes: TransactionChanges): Promise<number>;

  listRules(householdId: string): Promise<CategorizationRuleRow[]>;
  /** Insert, or replace the rule with the same match type and pattern. */
  saveRule(householdId: string, rule: RuleInput): Promise<void>;
  /** Insert rules that don't exist yet; existing ones are left untouched. */
  addMissingRules(householdId: string, rules: RuleInput[]): Promise<void>;
  updateRule(householdId: string, id: string, changes: Partial<RuleInput>): Promise<void>;
  deleteRule(householdId: string, id: string): Promise<void>;

  createCategory(householdId: string, category: CategoryInput): Promise<CategoryRow>;
  updateCategory(householdId: string, id: string, changes: { name?: string; is_active?: boolean }): Promise<void>;

  listBudgetLines(householdId: string): Promise<BudgetLineRow[]>;
  /**
   * Adds a budget line in one step, refusing (BudgetError "conflict") if
   * another active line already counts the same spending.
   */
  createBudgetLine(householdId: string, line: NewBudgetLine): Promise<void>;
  /**
   * Changes a line's amount and kind from a month on, in one step: the old
   * version ends the month before and a new one starts (or the line is updated
   * in place if it starts that month). BudgetError "stale" if it changed since.
   */
  changeBudgetLine(
    householdId: string,
    id: string,
    fromMonth: string,
    changes: Pick<BudgetLineRow, "amount" | "kind">,
  ): Promise<void>;
  /** Stops a line from a month on (deleted if it started that month). */
  endBudgetLine(householdId: string, id: string, fromMonth: string): Promise<void>;

  updateHouseholdSettings(
    householdId: string,
    changes: { review_starts_on?: string | null; time_zone?: string },
  ): Promise<void>;

  /** Removes one transaction (used only for hand-added entries). */
  deleteTransaction(householdId: string, id: string): Promise<void>;
  /**
   * Turns a hand-added entry into the bank's version of it, only while it's
   * still waiting to post. Returns false if it was already replaced (e.g. by an
   * earlier attempt of the same import), so retries never apply it twice.
   */
  replaceManualEntry(householdId: string, id: string, row: Partial<TransactionRow>): Promise<boolean>;

  listRecurringOverrides(householdId: string): Promise<RecurringOverrideRow[]>;
  /** Pass null to forget an override. */
  setRecurringOverride(householdId: string, key: string, status: RecurringStatus | null): Promise<void>;

  listBalances(householdId: string): Promise<AccountBalanceRow[]>;
  /** A balance typed in: replaces any balance for that account on that date. */
  saveBalance(householdId: string, balance: { account_id: string; as_of: string; balance: number }): Promise<void>;
  /** A balance read from an import: never replaces one already recorded for that date. */
  recordImportedBalance(householdId: string, balance: { account_id: string; as_of: string; balance: number }): Promise<void>;
  deleteBalance(householdId: string, id: string): Promise<void>;
  updateAccount(
    householdId: string,
    id: string,
    changes: Partial<Pick<AccountRow, "account_name" | "institution" | "is_active" | "closed_on">>,
  ): Promise<void>;

  listIncomeSources(householdId: string): Promise<IncomeSourceRow[]>;
  saveIncomeSource(
    householdId: string,
    source: Omit<IncomeSourceRow, "id" | "household_id" | "created_at" | "is_active">,
    id?: string,
  ): Promise<void>;
  deleteIncomeSource(householdId: string, id: string): Promise<void>;

  /**
   * Starts (or, for a retry with the same id, resumes) the signed-in person's
   * import. Returns the batch as stored.
   */
  startImportBatch(householdId: string, batch: { id: string; file_count: number }): Promise<ImportBatchRow>;
  getImportBatch(householdId: string, id: string): Promise<ImportBatchRow | null>;
  updateImportBatch(
    householdId: string,
    id: string,
    changes: Partial<Pick<ImportBatchRow, "status" | "matched" | "duplicates" | "sort_problem">>,
  ): Promise<void>;
  /** The signed-in person's most recent import that didn't finish, if any. */
  unfinishedImport(householdId: string): Promise<ImportBatchRow | null>;

  getMonthClosing(householdId: string, month: string): Promise<MonthClosingRow | null>;
  /** Records (or replaces) a month's closing snapshot. */
  saveMonthClosing(
    householdId: string,
    closing: Pick<MonthClosingRow, "month" | "spending_cents" | "income_cents" | "transaction_count">,
  ): Promise<void>;

  /** Every account's recorded coverage periods. */
  listCoverage(householdId: string): Promise<AccountCoverageRow[]>;
  /** Records that an account's activity is complete from one date through another. */
  recordCoverage(
    householdId: string,
    period: { account_id: string; covered_from: string; covered_through: string; source: "import" | "confirmed" },
  ): Promise<void>;
}
